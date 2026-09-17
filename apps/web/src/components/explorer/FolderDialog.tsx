import { Schema } from "effect";
import { useRef, useState } from "react";
import {
  ChatFolderId,
  CommandId,
  type ChatOrganizationCommand,
  OrchestrationDispatchCommandError,
} from "@t3tools/contracts";
import {
  CHAT_ORGANIZATION_ID,
  EMPTY_CHAT_ORGANIZATION,
  folderAncestors,
} from "@t3tools/shared/chatOrganization";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useProjects } from "../../state/entities";
import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { useComposerDraftStore } from "../../composerDraftStore";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useAtomCommand } from "../../state/use-atom-command";
import { randomUUID } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
} from "../ui/dialog";
import { useExplorerEnvironments, useFolderRequest, type FolderRequest } from "./state";

const isDispatchRejection = Schema.is(OrchestrationDispatchCommandError);

export function FolderDialogHost() {
  const request = useFolderRequest((state) => state.request);
  return request ? <FolderDialog key={JSON.stringify(request)} request={request} /> : null;
}
function FolderDialog({ request }: { request: FolderRequest }) {
  const env = useExplorerEnvironments().find((entry) => entry.id === request.environmentId);
  const organization = env?.organization ?? EMPTY_CHAT_ORGANIZATION;
  const folder =
    "folderId" in request
      ? organization.folders.find((entry) => entry.id === request.folderId)
      : undefined;
  const projects = useProjects().filter(
    (project) => project.environmentId === request.environmentId,
  );
  const { handleNewThread } = useHandleNewThread();
  const dispatch = useAtomCommand(orchestrationEnvironment.dispatchCommand, {
    reportFailure: false,
  });
  const [name, setName] = useState(request.kind === "rename" ? (folder?.name ?? "") : "");
  const [destination, setDestination] = useState<string>(
    request.kind === "move-threads" ? (request.targetId ?? "") : (folder?.parentId ?? ""),
  );
  const [beforeId, setBeforeId] = useState("");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [mode, setMode] = useState<"local" | "worktree">("worktree");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retry = useRef<{ signature: string; command: ChatOrganizationCommand } | null>(null);
  const newId = useRef(ChatFolderId.make(randomUUID()));
  const close = () => useFolderRequest.setState({ request: null });
  const title = {
    create: "Create folder",
    rename: "Rename folder",
    remove: "Remove folder",
    "move-folder": "Move folder",
    "move-threads": "Move chats",
    "new-chat": "New chat in folder",
  }[request.kind];
  const invalidScope =
    request.kind === "move-threads" &&
    request.threadRefs.some((ref) => ref.environmentId !== request.environmentId);
  const choices = organization.folders.filter(
    (entry) =>
      request.kind !== "move-folder" ||
      !folderAncestors(organization, entry.id).some((ancestor) => ancestor.id === request.folderId),
  );
  const submit = async () => {
    if (!env?.writable || invalidScope) return;
    setPending(true);
    setError(null);
    try {
      if (request.kind === "new-chat") {
        if (!folder) throw new Error("The folder was removed. Your existing drafts are unchanged.");
        const project = projects.find((entry) => entry.id === projectId);
        if (!project) throw new Error("Choose a project.");
        const result = await handleNewThread(scopeProjectRef(request.environmentId, project.id), {
          envMode: mode,
        });
        if (!result) throw new Error("Could not create a draft.");
        useComposerDraftStore.getState().setDraftThreadContext(result.draftId, {
          projectRef: scopeProjectRef(request.environmentId, project.id),
          environmentSelection: "manual",
          chatFolderTarget: { environmentId: request.environmentId, folderId: folder.id },
        });
        close();
        return;
      }
      const common = {
        commandId: CommandId.make(randomUUID()),
        organizationId: CHAT_ORGANIZATION_ID,
        expectedRevision: organization.revision,
      };
      let command: ChatOrganizationCommand;
      switch (request.kind) {
        case "create":
          command = {
            ...common,
            type: "chatFolder.create",
            folderId: newId.current,
            parentId: request.parentId,
            name: name.trim(),
          };
          break;
        case "rename":
          command = {
            ...common,
            type: "chatFolder.rename",
            folderId: request.folderId,
            name: name.trim(),
          };
          break;
        case "remove":
          command = { ...common, type: "chatFolder.remove", folderId: request.folderId };
          break;
        case "move-folder":
          command = {
            ...common,
            type: "chatFolder.move",
            folderId: request.folderId,
            parentId: destination ? ChatFolderId.make(destination) : null,
            ...(beforeId ? { beforeId: ChatFolderId.make(beforeId) } : {}),
          };
          break;
        case "move-threads":
          command = {
            ...common,
            type: "chatOrganization.assignThreads",
            threadIds: request.threadRefs.map((ref) => ref.threadId),
            folderId: destination ? ChatFolderId.make(destination) : null,
          };
          break;
      }
      // Retry a lost acknowledgement with exactly the original command ID/body.
      const signature = JSON.stringify({ request, name, destination, beforeId });
      if (retry.current?.signature === signature) command = retry.current.command;
      else retry.current = { signature, command };
      const result = await dispatch({ environmentId: request.environmentId, input: command });
      if (result._tag === "Failure") {
        const cause = squashAtomCommandFailure(result);
        const message = cause instanceof Error ? cause.message : "Could not update folders.";
        // A server rejection is terminal; transport failures retry the original command.
        if (isDispatchRejection(cause)) retry.current = null;
        throw new Error(message);
      }
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update folders.");
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) close();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {request.kind === "remove"
              ? `Remove “${folder?.name ?? "folder"}”? Its chats and direct subfolders move to the parent. Conversations are retained.`
              : "Folders organize chats within this environment. Their projects and workspaces stay the same."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            className="space-y-4"
            onKeyDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {(request.kind === "create" || request.kind === "rename") && (
              <label className="block text-sm">
                Folder name
                <Input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </label>
            )}
            {(request.kind === "move-threads" || request.kind === "move-folder") && (
              <label className="block text-sm">
                Destination
                <select
                  aria-label="Destination folder"
                  className="mt-1 w-full rounded border bg-background p-2"
                  value={destination}
                  onChange={(event) => {
                    setDestination(event.target.value);
                    setBeforeId("");
                  }}
                >
                  <option value="">{request.kind === "move-threads" ? "Unfiled" : "Root"}</option>
                  {choices.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {folderAncestors(organization, entry.id)
                        .map((ancestor) => ancestor.name)
                        .join(" / ")}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {request.kind === "move-folder" && (
              <label className="block text-sm">
                Position
                <select
                  aria-label="Folder position"
                  className="mt-1 w-full rounded border bg-background p-2"
                  value={beforeId}
                  onChange={(event) => setBeforeId(event.target.value)}
                >
                  <option value="">Last</option>
                  {organization.folders
                    .filter(
                      (entry) =>
                        entry.id !== request.folderId && entry.parentId === (destination || null),
                    )
                    .sort((a, b) => a.position - b.position)
                    .map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        Before {entry.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {request.kind === "new-chat" && (
              <>
                <label className="block text-sm">
                  Project
                  <select
                    aria-label="Project for new chat"
                    className="mt-1 w-full rounded border bg-background p-2"
                    value={projectId}
                    onChange={(event) => setProjectId(event.target.value)}
                  >
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  Workspace
                  <select
                    aria-label="Workspace mode"
                    className="mt-1 w-full rounded border bg-background p-2"
                    value={mode}
                    onChange={(event) =>
                      setMode(event.target.value === "local" ? "local" : "worktree")
                    }
                  >
                    <option value="worktree">New worktree</option>
                    <option value="local">Local checkout</option>
                  </select>
                </label>
              </>
            )}
            {invalidScope && (
              <p role="alert" className="text-sm text-destructive">
                Choose chats from one environment. A folder cannot span environments.
              </p>
            )}
            {!env?.writable && (
              <p role="status" className="text-sm text-muted-foreground">
                Folder changes require a connected, synchronized environment with folder support.
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={pending} onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !env?.writable || invalidScope}>
                {pending
                  ? "Saving…"
                  : request.kind === "remove"
                    ? "Remove folder"
                    : request.kind === "new-chat"
                      ? "Create chat"
                      : "Save"}
              </Button>
            </div>
          </form>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

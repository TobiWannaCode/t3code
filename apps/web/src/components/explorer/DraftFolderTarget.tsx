import { ChatFolderId, type EnvironmentId } from "@t3tools/contracts";
import { DraftId, useComposerDraftStore } from "../../composerDraftStore";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { explorerEnvironmentsAtom, useExplorerEnvironments } from "./state";
import { folderAncestors } from "@t3tools/shared/chatOrganization";

export function draftFolderSendError(
  draftId: DraftId | null,
  environmentId: EnvironmentId | undefined,
): string | null {
  if (!draftId) return null;
  const target = useComposerDraftStore.getState().getDraftSession(draftId)?.chatFolderTarget;
  if (!target) return null;
  if (target.environmentId !== environmentId)
    return "This draft's folder belongs to another environment. Choose a folder here or Continue in Unfiled.";
  const env = appAtomRegistry
    .get(explorerEnvironmentsAtom)
    .find((entry) => entry.id === target.environmentId);
  if (!env?.writable)
    return "Wait for the folder environment to reconnect and synchronize, or Continue in Unfiled.";
  if (!env.organization.folders.some((folder) => folder.id === target.folderId))
    return "This draft's folder was removed. Choose another folder or Continue in Unfiled.";
  return null;
}
export function DraftFolderTarget({ draftId }: { draftId: DraftId | null }) {
  const draft = useComposerDraftStore((state) => (draftId ? state.getDraftSession(draftId) : null));
  const environments = useExplorerEnvironments();
  const env = environments.find((entry) => entry.id === draft?.environmentId);
  const target = draft?.chatFolderTarget;
  if (!draftId || !draft || !target) return null;
  const valid =
    target.environmentId === draft.environmentId &&
    env?.organization.folders.some((folder) => folder.id === target.folderId);
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
      <label>
        Folder{" "}
        <select
          aria-label="Draft folder"
          className="max-w-64 rounded border bg-background px-2 py-1"
          value={valid ? target.folderId : "missing"}
          onChange={(event) =>
            useComposerDraftStore.getState().setDraftThreadContext(draftId, {
              chatFolderTarget: event.target.value
                ? {
                    environmentId: draft.environmentId,
                    folderId: ChatFolderId.make(event.target.value),
                  }
                : null,
            })
          }
        >
          {!valid && (
            <option value="missing" disabled>
              Folder unavailable in this environment
            </option>
          )}
          <option value="">Unfiled</option>
          {env?.organization.folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folderAncestors(env.organization, folder.id)
                .map((entry) => entry.name)
                .join(" / ")}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="underline"
        onClick={() =>
          useComposerDraftStore
            .getState()
            .setDraftThreadContext(draftId, { chatFolderTarget: null })
        }
      >
        Continue in Unfiled
      </button>
    </div>
  );
}

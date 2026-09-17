import { useState } from "react";
import { create } from "zustand";
import {
  CommandId,
  type ClientOrchestrationCommand,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useThreadShell } from "../state/entities";
import { orchestrationEnvironment } from "../state/orchestration";
import { useAtomCommand } from "../state/use-atom-command";
import { readLocalApi } from "../localApi";
import { randomUUID } from "../lib/utils";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
} from "./ui/dialog";

const useRequest = create<{ threadRef: ScopedThreadRef | null }>(() => ({ threadRef: null }));
export function openBranchNaming(threadRef: ScopedThreadRef) {
  useRequest.setState({ threadRef });
}
export function BranchNamingDialogHost() {
  const threadRef = useRequest((state) => state.threadRef);
  return threadRef ? (
    <BranchNamingDialog key={scopedThreadKey(threadRef)} threadRef={threadRef} />
  ) : null;
}
function BranchNamingDialog({ threadRef }: { threadRef: ScopedThreadRef }) {
  const thread = useThreadShell(threadRef);
  const dispatch = useAtomCommand(orchestrationEnvironment.dispatchCommand, {
    reportFailure: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const operation = thread?.branchNaming;
  const recovery = operation?.state === "needs-attention" || operation?.state === "prepared";
  const active = !!operation && operation.state !== "failed" && operation.state !== "completed";
  const running =
    thread?.session?.status === "running" ||
    thread?.session?.status === "starting" ||
    thread?.latestTurn?.state === "running";
  const act = async (input: ClientOrchestrationCommand) => {
    setPending(true);
    setError(null);
    try {
      const result = await dispatch({ environmentId: threadRef.environmentId, input });
      if (result._tag === "Failure") {
        const cause = squashAtomCommandFailure(result);
        setError(cause instanceof Error ? cause.message : "Branch naming request failed.");
      }
    } finally {
      setPending(false);
    }
  };
  const commandBase = () => ({
    commandId: CommandId.make(randomUUID()),
    threadId: threadRef.threadId,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) useRequest.setState({ threadRef: null });
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Branch naming</DialogTitle>
          <DialogDescription>{thread?.title ?? "Chat unavailable"}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4 text-sm">
          <p className="break-all">
            <code>{thread?.branch ?? "No local branch"}</code>
          </p>
          <p role="status">
            {operation?.detail ??
              (active
                ? "Generating branch name…"
                : "Generate a name using this conversation and the project's branch naming rules.")}
          </p>
          {operation?.target && (
            <p className="break-all text-muted-foreground">
              <code>{operation.expectedBranch}</code> → <code>{operation.target}</code>
            </p>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          {recovery && operation ? (
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={pending}
                onClick={() =>
                  void act({
                    ...commandBase(),
                    type: "thread.branch-naming.recheck",
                    operationId: operation.id,
                  })
                }
              >
                Recheck branch state
              </Button>
              {operation.actualBranch && operation.actualOid && (
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={async () => {
                    if (
                      !(await readLocalApi()?.dialogs.confirm(
                        `Use ${operation.actualBranch} for chats sharing this workspace? This repairs chat metadata without changing Git refs or files.`,
                      ))
                    )
                      return;
                    await act({
                      ...commandBase(),
                      type: "thread.branch-naming.use-current-branch",
                      operationId: operation.id,
                      branch: operation.actualBranch!,
                      oid: operation.actualOid!,
                    });
                  }}
                >
                  Use current branch for this workspace
                </Button>
              )}
            </div>
          ) : (
            <Button
              disabled={pending || active || running || !thread?.branch}
              onClick={() => {
                if (thread?.branch)
                  void act({
                    ...commandBase(),
                    type: "thread.branch.regenerate",
                    expectedBranch: thread.branch,
                    createdAt: new Date().toISOString(),
                  });
              }}
            >
              {active ? "Naming in progress…" : "Regenerate branch name"}
            </Button>
          )}
          {running && (
            <p className="text-muted-foreground">
              Wait for the active turn to finish before regenerating.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Local rename only. Existing remote branches and pull requests retain their names.
          </p>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

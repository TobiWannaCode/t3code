import type { BranchNamingOperation, EnvironmentId } from "@t3tools/contracts";
import type { DraftThreadState } from "./composerDraftStore";

export function renamedDraftBranches(
  threads: readonly {
    environmentId: EnvironmentId;
    branch: string | null;
    branchNaming?: BranchNamingOperation | null | undefined;
  }[],
  drafts: Readonly<Record<string, DraftThreadState>>,
  projectRoot: (draft: DraftThreadState) => string | null,
): readonly (readonly [string, string])[] {
  if (Object.keys(drafts).length === 0) return [];
  const renamed = new Map<string, BranchNamingOperation>();
  const key = (environmentId: EnvironmentId, cwd: string, branch: string) =>
    JSON.stringify([environmentId, cwd, branch]);
  for (const thread of threads) {
    const op = thread.branchNaming;
    if (op?.state !== "completed" || !op.cwd || !op.target || thread.branch !== op.target) continue;
    for (const cwd of new Set([op.cwd, op.sourceWorkspace ?? op.cwd])) {
      const identity = key(thread.environmentId, cwd, op.expectedBranch);
      const previous = renamed.get(identity);
      if (!previous || previous.updatedAt < op.updatedAt) renamed.set(identity, op);
    }
  }
  return Object.entries(drafts).flatMap(([id, draft]) => {
    const cwd = draft.worktreePath ?? projectRoot(draft);
    const target =
      cwd && draft.branch
        ? renamed.get(key(draft.environmentId, cwd, draft.branch))?.target
        : undefined;
    return target && target !== draft.branch ? [[id, target] as const] : [];
  });
}

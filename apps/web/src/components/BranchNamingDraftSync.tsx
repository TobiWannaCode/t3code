import { useEffect } from "react";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { renamedDraftBranches } from "../branchNamingDrafts";
import { readProject, useThreadShells } from "../state/entities";

export function BranchNamingDraftSync() {
  const threads = useThreadShells();
  const drafts = useComposerDraftStore((state) => state.draftThreadsByThreadKey);
  useEffect(() => {
    const changes = renamedDraftBranches(
      threads,
      drafts,
      (draft) =>
        readProject({ environmentId: draft.environmentId, projectId: draft.projectId })
          ?.workspaceRoot ?? null,
    );
    for (const [id, branch] of changes)
      useComposerDraftStore.getState().setDraftThreadContext(DraftId.make(id), { branch });
  }, [threads, drafts]);
  return null;
}

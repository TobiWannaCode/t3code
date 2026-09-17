import { expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId, type BranchNamingOperation } from "@t3tools/contracts";
import { renamedDraftBranches } from "./branchNamingDrafts";
import type { DraftThreadState } from "./composerDraftStore";
const environmentId = EnvironmentId.make("local");
const draft: DraftThreadState = {
  environmentId,
  threadId: ThreadId.make("draft"),
  projectId: ProjectId.make("project"),
  logicalProjectKey: "project",
  createdAt: "now",
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: "old",
  worktreePath: "/worktree",
  envMode: "worktree",
  startFromOrigin: false,
};
const operation: BranchNamingOperation = {
  id: "op",
  source: "regenerate",
  state: "completed",
  revision: 4,
  expectedBranch: "old",
  target: "new",
  cwd: "/worktree",
  createdAt: "now",
  updatedAt: "now",
};
it("updates drafts in the renamed workspace without crossing environments", () => {
  const changes = renamedDraftBranches(
    [{ environmentId, branch: "new", branchNaming: operation }],
    {
      match: draft,
      remote: { ...draft, environmentId: EnvironmentId.make("remote") },
      other: { ...draft, worktreePath: "/other" },
      selected: { ...draft, branch: "user-selected" },
    },
    () => null,
  );
  expect(changes).toEqual([["match", "new"]]);
});
it("ignores pending renames and old results after a branch checkout", () => {
  expect(
    renamedDraftBranches(
      [{ environmentId, branch: "old", branchNaming: operation }],
      { draft },
      () => null,
    ),
  ).toEqual([]);
  expect(
    renamedDraftBranches(
      [{ environmentId, branch: "new", branchNaming: { ...operation, state: "prepared" } }],
      { draft },
      () => null,
    ),
  ).toEqual([]);
});

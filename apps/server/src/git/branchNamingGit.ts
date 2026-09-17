// @effect-diagnostics nodeBuiltinImport:off -- Git workspace identity is canonicalized with native filesystem paths.
import { branchNamingError } from "./branchNamingError.ts";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { Effect } from "effect";
import type { GitVcsDriver } from "../vcs/GitVcsDriver.ts";
type GitCoreShape = GitVcsDriver["Service"];
import { canonicalRepository } from "./GitMutationCoordinator.ts";
import { buildBranchNameCandidate } from "@t3tools/shared/branchNaming";

export const readBranchIdentity = (git: GitCoreShape, cwd: string) =>
  Effect.gen(function* () {
    const run = (args: string[]) =>
      git.execute({ cwd, operation: "branchNaming.inspect", args, allowNonZeroExit: true });
    const root = yield* run(["rev-parse", "--show-toplevel"]);
    const branch = yield* run(["symbolic-ref", "--quiet", "--short", "HEAD"]);
    const oid = yield* run(["rev-parse", "--verify", "HEAD"]);
    if (root.exitCode || branch.exitCode || oid.exitCode)
      return yield* branchNamingError("A checked-out local branch with commits is required.");
    return {
      cwd: yield* Effect.tryPromise(() => NodeFSP.realpath(root.stdout.trim())),
      repositoryKey: yield* canonicalRepository(cwd),
      branch: branch.stdout.trim(),
      oid: oid.stdout.trim(),
      upstreamRemote: yield* git.readConfigValue(cwd, `branch.${branch.stdout.trim()}.remote`),
      upstreamMerge: yield* git.readConfigValue(cwd, `branch.${branch.stdout.trim()}.merge`),
    };
  });

export const checkBranchEligibility = (git: GitCoreShape, cwd: string, expectedBranch: string) =>
  Effect.gen(function* () {
    const identity = yield* readBranchIdentity(git, cwd);
    if (identity.branch !== expectedBranch)
      return yield* branchNamingError(
        "The checked-out branch changed. Refresh the chat workspace.",
      );
    const run = (args: string[]) =>
      git.execute({ cwd, operation: "branchNaming.validate", args, allowNonZeroExit: true });
    const remotes = (yield* run(["remote"])).stdout.trim().split("\n").filter(Boolean);
    const protectedBranches = new Set(["main", "master"]);
    const initial = yield* git.readConfigValue(cwd, "init.defaultBranch");
    if (initial) protectedBranches.add(initial);
    for (const remote of remotes) {
      const head = yield* run([
        "symbolic-ref",
        "--quiet",
        "--short",
        `refs/remotes/${remote}/HEAD`,
      ]);
      if (head.exitCode)
        return yield* branchNamingError(
          `Cannot resolve the default branch for ${remote}. Fetch its default-branch metadata first.`,
        );
      protectedBranches.add(head.stdout.trim().slice(remote.length + 1));
    }
    if (protectedBranches.has(identity.branch))
      return yield* branchNamingError("Default branches cannot be renamed.");
    for (const marker of [
      "MERGE_HEAD",
      "CHERRY_PICK_HEAD",
      "REVERT_HEAD",
      "BISECT_START",
      "rebase-merge",
      "rebase-apply",
      "sequencer",
    ]) {
      const path = (yield* run(["rev-parse", "--git-path", marker])).stdout.trim();
      const exists = yield* Effect.promise(() =>
        NodeFSP.access(NodePath.resolve(cwd, path)).then(
          () => true,
          () => false,
        ),
      );
      if (exists)
        return yield* branchNamingError(
          "Finish the current merge, rebase, cherry-pick, revert, or bisect before renaming.",
        );
    }
    const worktrees = (yield* run(["worktree", "list", "--porcelain"])).stdout;
    if (
      worktrees.split("\n").filter((line) => line === `branch refs/heads/${identity.branch}`)
        .length !== 1
    )
      return yield* branchNamingError("The branch must be checked out in exactly one worktree.");
    return identity;
  });

export const availableBranchName = (
  git: GitCoreShape,
  cwd: string,
  template: string,
  slug: string,
  oldBranch?: string,
  legacyBranch?: string,
) =>
  Effect.gen(function* () {
    const names = yield* git.listLocalBranchNames(cwd);
    for (let index = 0; index <= 100; index++) {
      const candidate = yield* Effect.try({
        try: () =>
          legacyBranch
            ? `${legacyBranch}${index ? `-${index}` : ""}`
            : buildBranchNameCandidate(template, slug, index),
        catch: (cause) => branchNamingError(String(cause)),
      });
      if (
        names.some(
          (name) =>
            name !== oldBranch &&
            (name === candidate ||
              name.startsWith(`${candidate}/`) ||
              candidate.startsWith(`${name}/`)),
        )
      )
        continue;
      const valid = yield* git.execute({
        cwd,
        operation: "branchNaming.validate",
        args: ["check-ref-format", "--branch", candidate],
        allowNonZeroExit: true,
      });
      if (valid.exitCode)
        return yield* branchNamingError("Git rejected the generated branch name.");
      return candidate;
    }
    return yield* branchNamingError("No available branch name after 100 collision suffixes.");
  });

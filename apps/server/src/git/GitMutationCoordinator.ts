// @effect-diagnostics nodeBuiltinImport:off -- Git workspace identity is canonicalized with native filesystem paths.
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { Effect, Layer, Semaphore, Context } from "effect";
import { GitCommandError } from "@t3tools/contracts";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
export const canonicalRepository = (cwd: string) =>
  Effect.tryPromise({
    try: async () => {
      const result = await exec(
        "git",
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        { cwd, timeout: 10000, maxBuffer: 65536 },
      );
      return NodeFSP.realpath(NodePath.resolve(cwd, result.stdout.trim()));
    },
    catch: (cause) =>
      new GitCommandError({
        operation: "branchNaming.repository",
        command: "git rev-parse",
        cwd,
        detail: "Cannot resolve repository identity.",
        cause,
      }),
  });

export class GitMutationCoordinator extends Context.Service<
  GitMutationCoordinator,
  {
    readonly withRepository: <A, E, R>(
      cwd: string,
      effect: Effect.Effect<A, E, R>,
      recovery?: boolean,
    ) => Effect.Effect<A, E | GitCommandError, R>;
    readonly block: (key: string) => void;
    readonly unblock: (key: string) => void;
  }
>()("t3/git/GitMutationCoordinator") {}

export const GitMutationCoordinatorLive = Layer.effect(
  GitMutationCoordinator,
  Effect.sync(() => {
    const gates = new Map<string, { semaphore: Semaphore.Semaphore; users: number }>();
    const barriers = new Set<string>();
    return {
      block: (key: string) => {
        barriers.add(key);
      },
      unblock: (key: string) => {
        barriers.delete(key);
      },
      withRepository: <A, E, R>(cwd: string, effect: Effect.Effect<A, E, R>, recovery = false) =>
        Effect.gen(function* () {
          const key = yield* canonicalRepository(cwd);
          let gate = gates.get(key);
          if (!gate) {
            gate = { semaphore: Semaphore.makeUnsafe(1), users: 0 };
            gates.set(key, gate);
          }
          gate.users++;
          const held = gate;
          return yield* held.semaphore
            .withPermits(1)(
              Effect.gen(function* () {
                if (!recovery && barriers.has(key))
                  return yield* new GitCommandError({
                    operation: "branchNaming.recovery",
                    command: "git",
                    cwd,
                    detail: "Reconcile the pending branch rename before using this repository.",
                  });
                return yield* effect;
              }),
            )
            .pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  if (--held.users === 0) gates.delete(key);
                }),
              ),
            );
        }),
    };
  }),
);

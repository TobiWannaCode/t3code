// @effect-diagnostics nodeBuiltinImport:off -- Real Git fixtures verify filesystem and ref preservation across rename recovery.
import { it } from "@effect/vitest";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  MessageId,
  OrchestrationReadModel,
  ProjectId,
  ThreadId,
  type BranchNamingOperation,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { Effect, Layer, PubSub, Schema, Semaphore, Stream, Option, Crypto } from "effect";
import { afterEach, beforeEach, expect, vi } from "vite-plus/test";
import { layer as GitCoreLive } from "../../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { GitMutationCoordinatorLive } from "../../git/GitMutationCoordinator.ts";
import { BranchNamingService } from "../../git/BranchNamingService.ts";
import { ServerConfig } from "../../config.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import { decideOrchestrationCommand } from "../decider.ts";
import { projectEvent } from "../projector.ts";
import { BranchNamingReactor, BranchNamingReactorLive } from "./BranchNamingReactor.ts";

type TestEngine = OrchestrationEngineShape & {
  getReadModel: () => Effect.Effect<OrchestrationReadModel>;
};
let cwd: string;
const git = (...args: string[]) =>
  NodeChildProcess.execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
beforeEach(async () => {
  cwd = await NodeFSP.realpath(
    await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "branch-naming-test-")),
  );
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("commit", "--allow-empty", "-qm", "Initial");
  git("checkout", "-qb", "old-name");
});
afterEach(async () => {
  await NodeFSP.rm(cwd, { recursive: true, force: true });
});
const id = ThreadId.make("chat");
const siblingId = ThreadId.make("sibling");
const now = "2026-09-16T00:00:00.000Z";
function initialModel(operation?: BranchNamingOperation, running = false) {
  const thread = {
    id,
    projectId: ProjectId.make("project"),
    title: "Fix importer",
    modelSelection: { instanceId: "codex", model: "gpt-5" },
    runtimeMode: "full-access",
    branch: "old-name",
    worktreePath: cwd,
    latestTurn: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    messages: [
      {
        id: MessageId.make("request"),
        role: "user",
        text: "Fix importer regression",
        turnId: null,
        streaming: false,
        createdAt: now,
        updatedAt: now,
      },
    ],
    activities: [],
    checkpoints: [],
    session: running
      ? {
          threadId: id,
          status: "running",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        }
      : null,
    ...(operation ? { branchNaming: operation } : {}),
  };
  return Schema.decodeUnknownSync(OrchestrationReadModel)({
    snapshotSequence: 0,
    updatedAt: now,
    projects: [
      {
        id: "project",
        title: "Project",
        workspaceRoot: cwd,
        defaultModelSelection: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ],
    threads: [
      thread,
      { ...thread, id: siblingId, archivedAt: now, session: null, branchNaming: null },
    ],
  });
}
const generation = vi.fn(() =>
  Effect.succeed({ template: "Team/{AI_MESSAGE}-wip", slug: "fix-import", fingerprint: "policy" }),
);
const testLayer = () =>
  Layer.mergeAll(
    GitMutationCoordinatorLive,
    GitCoreLive.pipe(
      Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-branch-config-" })),
      Layer.provideMerge(VcsProcess.layer),
      Layer.provide(NodeServices.layer),
    ),
  );
const waitFor = (engine: TestEngine, state: BranchNamingOperation["state"]) =>
  Effect.gen(function* () {
    for (let count = 0; count < 300; count++) {
      const model = yield* engine.getReadModel();
      if (model.threads[0]?.branchNaming?.state === state) return model;
      yield* Effect.sleep("10 millis");
    }
    const model = yield* engine.getReadModel();
    throw new Error(
      `Timed out waiting for ${state}: ${`${model.threads[0]?.branchNaming?.state}: ${model.threads[0]?.branchNaming?.detail}`}`,
    );
  });
function runScenario<E>(
  model: OrchestrationReadModel,
  scenario: (
    engine: TestEngine,
  ) => Effect.Effect<void, E, BranchNamingReactor | import("effect").Scope.Scope>,
) {
  return Effect.scoped(
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto;
      const events = yield* PubSub.unbounded<OrchestrationEvent>();
      const gate = yield* Semaphore.make(1);
      const receipts = new Map<string, number>();
      const engine: TestEngine = {
        getReadModel: () => Effect.sync(() => model),
        readEvents: () => Stream.empty,
        readThreadEvents: () => Stream.empty,
        getThreadReplayStats: () => Effect.die("unused"),
        latestSequence: Effect.sync(() => model.snapshotSequence),
        subscribeDomainEvents: PubSub.subscribe(events).pipe(Effect.map(Stream.fromSubscription)),
        streamDomainEvents: Stream.fromPubSub(events),
        dispatch: (command) =>
          gate.withPermits(1)(
            Effect.gen(function* () {
              const receipt = receipts.get(command.commandId);
              if (receipt !== undefined) return { sequence: receipt };
              const decision = yield* decideOrchestrationCommand({
                command,
                readModel: model,
              }).pipe(
                Effect.provideService(Crypto.Crypto, crypto),
                Effect.catchTag("PlatformError", Effect.die),
              );
              for (const fact of Array.isArray(decision) ? decision : [decision]) {
                const event = {
                  ...fact,
                  sequence: model.snapshotSequence + 1,
                } as OrchestrationEvent;
                model = yield* projectEvent(model, event).pipe(Effect.orDie);
                yield* PubSub.publish(events, event);
              }
              receipts.set(command.commandId, model.snapshotSequence);
              return { sequence: model.snapshotSequence };
            }),
          ),
      };
      yield* scenario(engine).pipe(
        Effect.provide(BranchNamingReactorLive),
        Effect.provideService(OrchestrationEngineService, engine),
        Effect.provide(
          Layer.mock(ProjectionSnapshotQuery)({
            getCommandReadModel: () => Effect.sync(() => model),
            getThreadDetailById: (threadId) =>
              Effect.sync(() =>
                Option.fromNullishOr(model.threads.find((thread) => thread.id === threadId)),
              ),
          }),
        ),
        Effect.provideService(BranchNamingService, {
          generate: generation,
          fingerprint: () => Effect.succeed("policy"),
        }),
        Effect.provide(testLayer()),
      );
    }),
  ).pipe(Effect.provide(NodeServices.layer));
}

it.live("renames exactly once, keeps dirty files and updates archived sibling chats", () =>
  Effect.gen(function* () {
    generation.mockClear();
    git("branch", "Team/fix-import-wip");
    yield* Effect.promise(() => NodeFSP.writeFile(NodePath.join(cwd, "dirty.txt"), "keep me"));
    const oldOid = git("rev-parse", "HEAD");
    yield* runScenario(initialModel(), (engine) =>
      Effect.gen(function* () {
        yield* (yield* BranchNamingReactor).start();
        yield* Effect.sleep("10 millis");
        const command = {
          type: "thread.branch.regenerate" as const,
          commandId: CommandId.make("rename"),
          threadId: id,
          expectedBranch: "old-name",
          createdAt: now,
        };
        yield* engine.dispatch(command);
        yield* engine.dispatch(command);
        const completed = yield* waitFor(engine, "completed");
        expect(completed.threads.map((t) => t.branch)).toEqual([
          "Team/fix-import-1-wip",
          "Team/fix-import-1-wip",
        ]);
      }),
    );
    expect(generation).toHaveBeenCalledTimes(1);
    expect(git("branch", "--show-current")).toBe("Team/fix-import-1-wip");
    expect(git("rev-parse", "HEAD")).toBe(oldOid);
    expect(git("status", "--porcelain")).toContain("dirty.txt");
  }),
);

it.live("waits for idle before applying automatic naming", () =>
  Effect.gen(function* () {
    const operation: BranchNamingOperation = {
      id: "auto",
      source: "initial",
      state: "queued",
      revision: 0,
      expectedBranch: "old-name",
      createdAt: now,
      updatedAt: now,
    };
    yield* runScenario(initialModel(operation, true), (engine) =>
      Effect.gen(function* () {
        yield* (yield* BranchNamingReactor).start();
        yield* waitFor(engine, "waiting");
        expect(git("branch", "--show-current")).toBe("old-name");
        yield* engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.make("idle"),
          threadId: id,
          session: {
            threadId: id,
            status: "ready",
            runtimeMode: "full-access",
            providerName: "codex",
            activeTurnId: null,
            lastError: null,
            updatedAt: now,
          },
          createdAt: now,
        });
        yield* waitFor(engine, "completed");
      }),
    );
  }),
);

it.live("recovers Git success after restart without another model call or rename", () =>
  Effect.gen(function* () {
    generation.mockClear();
    const op: BranchNamingOperation = {
      id: "prepared",
      source: "regenerate",
      state: "prepared",
      revision: 3,
      expectedBranch: "old-name",
      createdAt: now,
      updatedAt: now,
      cwd,
      repositoryKey: yield* Effect.promise(() => NodeFSP.realpath(NodePath.join(cwd, ".git"))),
      target: "Team/fix-import-wip",
      oldOid: git("rev-parse", "HEAD"),
      upstreamRemote: null,
      upstreamMerge: null,
      affectedThreadIds: [id, siblingId],
    };
    git("branch", "-m", "old-name", op.target!);
    yield* runScenario(initialModel(op), (engine) =>
      Effect.gen(function* () {
        yield* (yield* BranchNamingReactor).start();
        const model = yield* waitFor(engine, "completed");
        expect(model.threads[1]?.branch).toBe(op.target);
      }),
    );
    expect(generation).not.toHaveBeenCalled();
  }),
);

it.live("blocks ambiguous recovery until explicitly repairing metadata", () =>
  Effect.gen(function* () {
    const op: BranchNamingOperation = {
      id: "prepared",
      source: "regenerate",
      state: "prepared",
      revision: 3,
      expectedBranch: "old-name",
      createdAt: now,
      updatedAt: now,
      cwd,
      repositoryKey: yield* Effect.promise(() => NodeFSP.realpath(NodePath.join(cwd, ".git"))),
      target: "Team/fix-import-wip",
      oldOid: git("rev-parse", "HEAD"),
      affectedThreadIds: [id, siblingId],
    };
    git("branch", op.target!);
    yield* runScenario(initialModel(op), (engine) =>
      Effect.gen(function* () {
        yield* (yield* BranchNamingReactor).start();
        yield* waitFor(engine, "needs-attention");
        const rejected = yield* engine
          .dispatch({
            type: "thread.delete",
            commandId: CommandId.make("delete"),
            threadId: siblingId,
          })
          .pipe(Effect.result);
        expect(rejected._tag).toBe("Failure");
        yield* Effect.sleep("10 millis");
        yield* engine.dispatch({
          type: "thread.branch-naming.use-current-branch",
          commandId: CommandId.make("repair"),
          threadId: id,
          operationId: op.id,
          branch: "old-name",
          oid: op.oldOid!,
        });
        yield* waitFor(engine, "completed");
      }),
    );
    expect(git("branch", "--show-current")).toBe("old-name");
    expect(git("branch", "--list", op.target!)).toContain(op.target);
  }),
);

it.live("preserves upstream tracking and remote refs during a local rename", () =>
  Effect.gen(function* () {
    const remote = NodePath.join(cwd, "remote.git");
    git("init", "--bare", "-q", remote);
    git("remote", "add", "origin", remote);
    git("push", "-q", "origin", "main", "old-name");
    git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    git("branch", "--set-upstream-to=origin/old-name", "old-name");
    const refsBefore = NodeChildProcess.execFileSync("git", ["--git-dir", remote, "show-ref"], {
      encoding: "utf8",
    });
    yield* runScenario(initialModel(), (engine) =>
      Effect.gen(function* () {
        yield* (yield* BranchNamingReactor).start();
        yield* engine.dispatch({
          type: "thread.branch.regenerate",
          commandId: CommandId.make("tracked"),
          threadId: id,
          expectedBranch: "old-name",
          createdAt: now,
        });
        const model = yield* waitFor(engine, "completed");
        expect(model.threads[0]?.branchNaming?.detail).toContain("Still tracking origin/old-name");
      }),
    );
    expect(git("rev-parse", "--abbrev-ref", "@{upstream}")).toBe("origin/old-name");
    expect(
      NodeChildProcess.execFileSync("git", ["--git-dir", remote, "show-ref"], { encoding: "utf8" }),
    ).toBe(refsBefore);
  }),
);

it.live("discards a generated name if the chat changes workspace during generation", () =>
  Effect.gen(function* () {
    yield* runScenario(initialModel(), (engine) =>
      Effect.gen(function* () {
        generation.mockImplementationOnce(() =>
          engine
            .dispatch({
              type: "thread.meta.update",
              commandId: CommandId.make("move-workspace"),
              threadId: id,
              worktreePath: `${cwd}/different-worktree`,
            })
            .pipe(
              Effect.as({
                template: "Team/{AI_MESSAGE}-wip",
                slug: "fix-import",
                fingerprint: "policy",
              }),
              Effect.orDie,
            ),
        );
        yield* (yield* BranchNamingReactor).start();
        yield* engine.dispatch({
          type: "thread.branch.regenerate",
          commandId: CommandId.make("stale-workspace"),
          threadId: id,
          expectedBranch: "old-name",
          createdAt: now,
        });
        const model = yield* waitFor(engine, "failed");
        expect(model.threads[0]?.branchNaming?.detail).toContain("workspace changed");
      }),
    );
    expect(git("branch", "--show-current")).toBe("old-name");
  }),
);

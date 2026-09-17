import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { BranchNamingOperation, ThreadId } from "@t3tools/contracts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { ProjectionThreadRepositoryLive } from "./ProjectionThreads.ts";
import { ProjectionThreadRepository } from "../Services/ProjectionThreads.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../../orchestration/Layers/ProjectionSnapshotQuery.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import * as ThreadBackgroundLiveness from "../../orchestration/ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../../orchestration/ThreadPlanProgress.ts";

const decodeOperation = Schema.decodeUnknownEffect(BranchNamingOperation);
const layer = Layer.mergeAll(
  ProjectionThreadRepositoryLive,
  OrchestrationProjectionSnapshotQueryLive,
).pipe(
  Layer.provide(ThreadBackgroundLiveness.layer),
  Layer.provide(ThreadPlanProgress.layer),
  Layer.provide(
    Layer.succeed(RepositoryIdentityResolver.RepositoryIdentityResolver, {
      resolve: () => Effect.succeed(null),
    }),
  ),
  Layer.provideMerge(SqlitePersistenceMemory),
);
it.effect("round-trips a prepared rename through command, shell and detail projections", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const query = yield* ProjectionSnapshotQuery;
    const repository = yield* ProjectionThreadRepository;
    const timestamp = "2026-09-16T00:00:00.000Z";
    yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at) VALUES ('project', 'Project', '/repo', '[]', ${timestamp}, ${timestamp})`;
    yield* sql`INSERT INTO projection_threads (thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode, created_at, updated_at) VALUES ('chat', 'project', 'Chat', '{"instanceId":"codex","model":"gpt-5"}', 'full-access', 'default', ${timestamp}, ${timestamp})`;
    const threadId = ThreadId.make("chat");
    const operation = yield* decodeOperation({
      id: "rename",
      source: "regenerate",
      state: "prepared",
      revision: 3,
      expectedBranch: "old",
      createdAt: timestamp,
      updatedAt: timestamp,
      cwd: "/repo",
      repositoryKey: "/repo/.git",
      target: "Team/fix-wip",
      oldOid: "oid",
      affectedThreadIds: [threadId],
    });
    const original = Option.getOrThrow(yield* repository.getById({ threadId }));
    yield* repository.upsert({ ...original, branchNaming: operation });
    assert.deepEqual(
      Option.getOrThrow(yield* repository.getById({ threadId })).branchNaming,
      operation,
    );
    assert.deepEqual((yield* query.getCommandReadModel()).threads[0]?.branchNaming, operation);
    assert.deepEqual((yield* query.getShellSnapshot()).threads[0]?.branchNaming, operation);
    assert.deepEqual(
      Option.getOrThrow(yield* query.getThreadShellById(threadId)).branchNaming,
      operation,
    );
    assert.deepEqual(
      Option.getOrThrow(yield* query.getThreadDetailById(threadId)).branchNaming,
      operation,
    );
  }).pipe(Effect.provide(layer)),
);

import { ChatOrganization, type ChatOrganizationChange } from "@t3tools/contracts";
import { Effect, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { toPersistenceSqlError } from "./Errors.ts";

export const makeChatOrganizationProjection = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const read = Effect.fn("ChatOrganizationProjection.read")(
    function* () {
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const state = yield* sql<{
            revision: number;
          }>`SELECT revision FROM projection_chat_organization_state WHERE id = 1`;
          const folders =
            yield* sql`SELECT id, parent_id AS "parentId", name, position, created_at AS "createdAt", updated_at AS "updatedAt" FROM projection_chat_folders ORDER BY position, id`;
          const memberships =
            yield* sql`SELECT thread_id AS "threadId", folder_id AS "folderId", position FROM projection_chat_folder_memberships ORDER BY thread_id`;
          return yield* Schema.decodeUnknownEffect(ChatOrganization)({
            revision: state[0]?.revision ?? 0,
            folders,
            memberships: memberships.map(({ position, ...member }) => ({
              ...member,
              ...(position === null ? {} : { position }),
            })),
          });
        }),
      );
    },
    Effect.mapError(toPersistenceSqlError("ChatOrganizationProjection.read")),
  );
  const apply = Effect.fn("ChatOrganizationProjection.apply")(
    function* (change: ChatOrganizationChange) {
      for (const id of change.removedFolderIds)
        yield* sql`DELETE FROM projection_chat_folders WHERE id = ${id}`;
      for (const folder of change.folders)
        yield* sql`INSERT INTO projection_chat_folders (id, parent_id, name, position, created_at, updated_at) VALUES (${folder.id}, ${folder.parentId}, ${folder.name}, ${folder.position}, ${folder.createdAt}, ${folder.updatedAt}) ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id, name=excluded.name, position=excluded.position, created_at=excluded.created_at, updated_at=excluded.updated_at`;
      for (const threadId of change.unassignedThreadIds)
        yield* sql`DELETE FROM projection_chat_folder_memberships WHERE thread_id = ${threadId}`;
      for (const membership of change.memberships)
        yield* sql`INSERT INTO projection_chat_folder_memberships (thread_id, folder_id, position) VALUES (${membership.threadId}, ${membership.folderId}, ${membership.position ?? null}) ON CONFLICT(thread_id) DO UPDATE SET folder_id=excluded.folder_id, position=excluded.position`;
      yield* sql`UPDATE projection_chat_organization_state SET revision = ${change.revision} WHERE id = 1`;
    },
    Effect.mapError(toPersistenceSqlError("ChatOrganizationProjection.apply")),
  );
  return { read, apply };
});

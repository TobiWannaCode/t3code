import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE projection_chat_folder_memberships RENAME TO projection_chat_folder_memberships_old`;
  yield* sql`CREATE TABLE projection_chat_folder_memberships (thread_id TEXT PRIMARY KEY, folder_id TEXT, position INTEGER)`;
  yield* sql`INSERT INTO projection_chat_folder_memberships (thread_id, folder_id) SELECT thread_id, folder_id FROM projection_chat_folder_memberships_old`;
  yield* sql`DROP TABLE projection_chat_folder_memberships_old`;
  yield* sql`CREATE INDEX projection_chat_folder_memberships_folder ON projection_chat_folder_memberships(folder_id, position, thread_id)`;
});

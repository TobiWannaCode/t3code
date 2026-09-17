import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE projection_chat_folders (id TEXT PRIMARY KEY, parent_id TEXT, name TEXT NOT NULL, position INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`;
  yield* sql`CREATE INDEX projection_chat_folders_parent ON projection_chat_folders(parent_id, position, id)`;
  yield* sql`CREATE TABLE projection_chat_folder_memberships (thread_id TEXT PRIMARY KEY, folder_id TEXT NOT NULL)`;
  yield* sql`CREATE INDEX projection_chat_folder_memberships_folder ON projection_chat_folder_memberships(folder_id, thread_id)`;
  yield* sql`CREATE TABLE projection_chat_organization_state (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL)`;
  yield* sql`INSERT INTO projection_chat_organization_state (id, revision) VALUES (1, 0)`;
});

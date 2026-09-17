import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { orderExplorerThreads, type ExplorerNode } from "./model";
import { ChatFolderId, EnvironmentId, ThreadId, type ChatOrganization } from "@t3tools/contracts";
import { Schema } from "effect";
export const EXPLORER_DRAG_TYPE = "application/x-t3-chat-folder";
const payload = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("folder"),
    environmentId: EnvironmentId,
    folderId: ChatFolderId,
  }),
  Schema.Struct({
    kind: Schema.Literal("threads"),
    environmentId: EnvironmentId,
    refs: Schema.Array(Schema.Struct({ environmentId: EnvironmentId, threadId: ThreadId })).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(500),
    ),
  }),
]);
export const decodeExplorerDrag = Schema.decodeUnknownSync(Schema.fromJsonString(payload));

export function threadDropAssignment(
  movingIds: readonly ThreadId[],
  node: ExplorerNode,
  organization: ChatOrganization,
  threads: readonly EnvironmentThreadShell[],
  position: "before" | "after" | "inside",
) {
  const members = new Map(
    organization.memberships.map((member) => [member.threadId, member.folderId]),
  );
  const folderId =
    node.kind === "folder"
      ? node.folder.id
      : node.kind === "thread"
        ? (members.get(node.thread.id) ?? null)
        : null;
  const moving = new Set(movingIds);
  if (node.kind === "thread" && moving.has(node.thread.id))
    throw new Error("Choose a destination outside the selected chats.");
  const siblings = orderExplorerThreads(
    organization,
    threads.filter(
      (thread) =>
        thread.environmentId === node.environmentId &&
        (members.get(thread.id) ?? null) === folderId &&
        !moving.has(thread.id),
    ),
  ).map((thread) => thread.id);
  const index = node.kind === "thread" ? siblings.indexOf(node.thread.id) : siblings.length;
  if (index < 0) throw new Error("The destination chat changed. Try the move again.");
  siblings.splice(
    index + (node.kind === "thread" && position === "after" ? 1 : 0),
    0,
    ...movingIds,
  );
  return { folderId, orderedThreadIds: siblings };
}

import { Schema } from "effect";
import {
  ChatFolderId,
  ChatOrganizationId,
  CommandId,
  IsoDateTime,
  NonNegativeInt,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

export const ChatFolder = Schema.Struct({
  id: ChatFolderId,
  parentId: Schema.NullOr(ChatFolderId),
  name: TrimmedNonEmptyString.check(
    Schema.isMaxLength(240),
    Schema.isPattern(/^[^\u0000-\u001f\u007f-\u009f]+$/),
  ),
  position: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ChatFolder = typeof ChatFolder.Type;
export const ChatFolderMembership = Schema.Struct({
  threadId: ThreadId,
  folderId: Schema.NullOr(ChatFolderId),
  position: Schema.optional(NonNegativeInt),
});
export type ChatFolderMembership = typeof ChatFolderMembership.Type;
export const ChatOrganization = Schema.Struct({
  revision: NonNegativeInt,
  folders: Schema.Array(ChatFolder),
  memberships: Schema.Array(ChatFolderMembership),
});
export type ChatOrganization = typeof ChatOrganization.Type;
const CommandFields = {
  commandId: CommandId,
  organizationId: ChatOrganizationId,
  expectedRevision: NonNegativeInt,
};
export const ChatOrganizationCommand = Schema.Union([
  Schema.Struct({
    ...CommandFields,
    type: Schema.Literal("chatFolder.create"),
    folderId: ChatFolderId,
    parentId: Schema.NullOr(ChatFolderId),
    name: ChatFolder.fields.name,
    beforeId: Schema.optional(ChatFolderId),
  }),
  Schema.Struct({
    ...CommandFields,
    type: Schema.Literal("chatFolder.rename"),
    folderId: ChatFolderId,
    name: ChatFolder.fields.name,
  }),
  Schema.Struct({
    ...CommandFields,
    type: Schema.Literal("chatFolder.move"),
    folderId: ChatFolderId,
    parentId: Schema.NullOr(ChatFolderId),
    beforeId: Schema.optional(ChatFolderId),
  }),
  Schema.Struct({
    ...CommandFields,
    type: Schema.Literal("chatFolder.remove"),
    folderId: ChatFolderId,
  }),
  Schema.Struct({
    ...CommandFields,
    type: Schema.Literal("chatOrganization.assignThreads"),
    threadIds: Schema.Array(ThreadId).check(Schema.isMinLength(1), Schema.isMaxLength(500)),
    folderId: Schema.NullOr(ChatFolderId),
    orderedThreadIds: Schema.optional(
      Schema.Array(ThreadId).check(Schema.isMinLength(1), Schema.isMaxLength(10000)),
    ),
  }),
]);
export type ChatOrganizationCommand = typeof ChatOrganizationCommand.Type;

// Canonical deltas include renumbered siblings and hidden/archived memberships.
export const ChatOrganizationChange = Schema.Struct({
  revision: NonNegativeInt,
  folders: Schema.Array(ChatFolder),
  removedFolderIds: Schema.Array(ChatFolderId),
  memberships: Schema.Array(ChatFolderMembership),
  unassignedThreadIds: Schema.Array(ThreadId),
});
export type ChatOrganizationChange = typeof ChatOrganizationChange.Type;

import {
  EventId,
  type ChatOrganizationChange,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import {
  CHAT_ORGANIZATION_ID,
  EMPTY_CHAT_ORGANIZATION,
  decideOrganizationChange,
  organizationAssignment,
} from "@t3tools/shared/chatOrganization";
import { Crypto, DateTime, Effect } from "effect";
import { OrchestrationCommandInvariantError } from "./Errors.ts";

export const decideChatOrganization = Effect.fn("decideChatOrganization")(function* (
  command: OrchestrationCommand,
  model: OrchestrationReadModel,
) {
  const current = model.chatOrganization ?? EMPTY_CHAT_ORGANIZATION;
  if (
    !("organizationId" in command) &&
    !(command.type === "thread.create" && command.chatFolderId) &&
    !(
      command.type === "thread.delete" &&
      current.memberships.some((member) => member.threadId === command.threadId)
    )
  )
    return [];
  const occurredAt = DateTime.formatIso(yield* DateTime.now);
  const change: ChatOrganizationChange = yield* Effect.try({
    try: () => {
      if ("organizationId" in command)
        return decideOrganizationChange(
          current,
          command,
          occurredAt,
          new Set(
            model.threads.filter((thread) => thread.deletedAt === null).map((thread) => thread.id),
          ),
        );
      if (command.type === "thread.create")
        return organizationAssignment(current, [command.threadId], command.chatFolderId ?? null);
      if (command.type === "thread.delete")
        return organizationAssignment(current, [command.threadId], null);
      throw new Error("Unsupported organization command.");
    },
    catch: (cause) =>
      new OrchestrationCommandInvariantError({
        commandType: command.type,
        detail: cause instanceof Error ? cause.message : "Invalid folder operation.",
      }),
  });
  const eventType =
    command.type === "chatFolder.create"
      ? "chatFolder.created"
      : command.type === "chatFolder.rename"
        ? "chatFolder.renamed"
        : command.type === "chatFolder.move"
          ? "chatFolder.moved"
          : command.type === "chatFolder.remove"
            ? "chatFolder.removed"
            : "chatOrganization.threadsAssigned";
  const crypto = yield* Crypto.Crypto;
  return [
    {
      eventId: EventId.make(yield* crypto.randomUUIDv4),
      aggregateKind: "chat-organization",
      aggregateId: CHAT_ORGANIZATION_ID,
      occurredAt,
      commandId: command.commandId,
      causationEventId: null,
      correlationId: command.commandId,
      metadata: {},
      type: eventType,
      payload: change,
    },
  ] satisfies Omit<OrchestrationEvent, "sequence">[];
});

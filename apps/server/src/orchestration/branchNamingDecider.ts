import {
  EventId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type BranchNamingOperation,
} from "@t3tools/contracts";
import { Effect, Crypto, DateTime } from "effect";
import { OrchestrationCommandInvariantError } from "./Errors.ts";

export const namingIsActive = (operation?: BranchNamingOperation | null) =>
  !!operation && operation.state !== "completed" && operation.state !== "failed";
export const namingNeedsRecovery = (operation?: BranchNamingOperation | null) =>
  operation?.state === "prepared" || operation?.state === "needs-attention";

export const decideBranchNaming = Effect.fn("decideBranchNaming")(function* (
  command: OrchestrationCommand,
  model: OrchestrationReadModel,
) {
  if (!("threadId" in command)) return [];
  const thread = model.threads.find((entry) => entry.id === command.threadId);
  const fail = (detail: string) =>
    Effect.fail(new OrchestrationCommandInvariantError({ commandType: command.type, detail }));
  if (!thread) return yield* fail("Chat no longer exists.");
  const now = DateTime.formatIso(yield* DateTime.now);
  const cryptoService = yield* Crypto.Crypto;
  const base = {
    eventId: EventId.make(yield* cryptoService.randomUUIDv4),
    aggregateKind: "thread" as const,
    aggregateId: thread.id,
    occurredAt: now,
    commandId: command.commandId,
    causationEventId: null,
    correlationId: command.commandId,
    metadata: {},
  };
  const previous = thread.branchNaming;
  let operation: BranchNamingOperation;
  if (command.type === "thread.branch.regenerate") {
    if (
      thread.deletedAt ||
      thread.archivedAt ||
      !thread.branch ||
      thread.branch !== command.expectedBranch
    )
      return yield* fail("The chat branch changed or is unavailable.");
    if (
      namingIsActive(previous) &&
      !(previous?.source === "initial" && !namingNeedsRecovery(previous))
    )
      return yield* fail("A branch naming operation is already active.");
    operation = {
      id: command.commandId,
      source: "regenerate",
      state: "queued",
      revision: 0,
      expectedBranch: command.expectedBranch,
      createdAt: command.createdAt,
      updatedAt: now,
    };
  } else if (
    command.type === "thread.branch-naming.recheck" ||
    command.type === "thread.branch-naming.use-current-branch"
  ) {
    if (!previous || previous.id !== command.operationId || !namingNeedsRecovery(previous))
      return yield* fail("This operation no longer needs reconciliation.");
    return [
      {
        ...base,
        type: "thread.branch-naming-recovery-requested",
        payload: {
          threadId: thread.id,
          operationId: previous.id,
          ...(command.type === "thread.branch-naming.use-current-branch"
            ? { branch: command.branch, oid: command.oid }
            : {}),
        },
      },
    ] satisfies Omit<OrchestrationEvent, "sequence">[];
  } else if (command.type === "thread.branch-naming.set") {
    if ((previous?.revision ?? null) !== command.expectedRevision)
      return yield* fail("Branch naming operation changed.");
    operation = command.operation;
    if (previous && previous.id === operation.id) {
      const transitions: Record<
        BranchNamingOperation["state"],
        readonly BranchNamingOperation["state"][]
      > = {
        queued: ["generating", "failed"],
        generating: ["waiting", "failed"],
        waiting: ["prepared", "failed", "completed"],
        prepared: ["completed", "failed", "needs-attention"],
        "needs-attention": ["completed", "failed", "needs-attention"],
        completed: [],
        failed: [],
      };
      if (
        operation.revision !== previous.revision + 1 ||
        !transitions[previous.state].includes(operation.state)
      )
        return yield* fail("Invalid branch naming transition.");
    } else if (namingIsActive(previous) || operation.state !== "queued" || operation.revision !== 0)
      return yield* fail("Cannot replace an active naming operation.");
    if (
      operation.state === "prepared" &&
      (!operation.cwd ||
        !operation.repositoryKey ||
        !operation.target ||
        !operation.oldOid ||
        !operation.affectedThreadIds)
    )
      return yield* fail("A prepared rename requires its exact Git expectations.");
  } else return [];
  if (operation.state === "prepared") {
    const currentWorkspace =
      thread.worktreePath ?? model.projects.find((p) => p.id === thread.projectId)?.workspaceRoot;
    if (operation.sourceWorkspace && currentWorkspace !== operation.sourceWorkspace)
      return yield* fail("The chat workspace changed before the rename was prepared.");
    if (thread.deletedAt || thread.archivedAt || thread.branch !== operation.expectedBranch)
      return yield* fail("The source chat changed before the rename was prepared.");
    const affected = model.threads.filter((entry) =>
      operation.affectedThreadIds?.includes(entry.id),
    );
    if (
      affected.some(
        (entry) =>
          entry.session?.status === "running" ||
          entry.session?.status === "starting" ||
          entry.latestTurn?.state === "running",
      )
    )
      return yield* fail(
        "A turn started before the rename could be prepared. Regenerate after it finishes.",
      );
  }
  if (
    operation.repositoryKey &&
    namingIsActive(operation) &&
    model.threads.some(
      (entry) =>
        entry.id !== thread.id &&
        namingIsActive(entry.branchNaming) &&
        entry.branchNaming?.repositoryKey === operation.repositoryKey,
    )
  )
    return yield* fail("Another chat is naming a branch in this repository.");
  const events: Omit<OrchestrationEvent, "sequence">[] = [
    { ...base, type: "thread.branch-naming-updated", payload: { threadId: thread.id, operation } },
  ];
  if (operation.state === "completed" && operation.target) {
    for (const linked of model.threads) {
      if (
        linked.deletedAt ||
        !operation.affectedThreadIds?.includes(linked.id) ||
        linked.branch !== operation.expectedBranch
      )
        continue;
      events.push({
        ...base,
        eventId: EventId.make(yield* cryptoService.randomUUIDv4),
        aggregateId: linked.id,
        type: "thread.meta-updated",
        payload: { threadId: linked.id, branch: operation.target, updatedAt: now },
      });
    }
  }
  if (
    operation.state === "completed" ||
    operation.state === "failed" ||
    operation.state === "needs-attention"
  ) {
    events.push({
      ...base,
      eventId: EventId.make(yield* cryptoService.randomUUIDv4),
      type: "thread.activity-appended",
      payload: {
        threadId: thread.id,
        activity: {
          id: EventId.make(yield* cryptoService.randomUUIDv4),
          kind: "branch.naming",
          tone: operation.state === "completed" ? "info" : "error",
          summary: operation.detail ?? "Branch naming updated",
          payload: { operationId: operation.id },
          turnId: null,
          createdAt: now,
        },
      },
    });
  }
  return events;
});

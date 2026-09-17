import { assistantCitationsToPlainText } from "@t3tools/shared/assistantCitations";
import { VcsStatusBroadcaster } from "../../vcs/VcsStatusBroadcaster.ts";
import { branchNamingError } from "../../git/branchNamingError.ts";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Compare canonical workspace locations, including linked worktrees.
import * as NodeFSP from "node:fs/promises";
import {
  CommandId,
  type BranchNamingOperation,
  type OrchestrationReadModel,
  type OrchestrationThread,
  type ThreadId,
} from "@t3tools/contracts";
import { Cause, Effect, Layer, Context, Stream } from "effect";
import { GitVcsDriver as GitCore } from "../../vcs/GitVcsDriver.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { Option, DateTime, Crypto } from "effect";
import { GitMutationCoordinator } from "../../git/GitMutationCoordinator.ts";
import { BranchNamingService } from "../../git/BranchNamingService.ts";
import { branchNamingContext, branchNamingWatermark } from "../../git/branchNamingContext.ts";
import {
  availableBranchName,
  checkBranchEligibility,
  readBranchIdentity,
} from "../../git/branchNamingGit.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { namingIsActive, namingNeedsRecovery } from "../branchNamingDecider.ts";

export class BranchNamingReactor extends Context.Service<
  BranchNamingReactor,
  { readonly start: () => Effect.Effect<void, never, import("effect").Scope.Scope> }
>()("t3/orchestration/Layers/BranchNamingReactor") {}

const cwdFor = (thread: OrchestrationThread, model: OrchestrationReadModel) =>
  thread.worktreePath ?? model.projects.find((p) => p.id === thread.projectId)?.workspaceRoot;
const busy = (thread: OrchestrationThread) =>
  thread.session?.status === "running" ||
  thread.session?.status === "starting" ||
  thread.latestTurn?.state === "running";

export const BranchNamingReactorLive = Layer.effect(
  BranchNamingReactor,
  Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;
    const query = yield* ProjectionSnapshotQuery;
    const cryptoService = yield* Crypto.Crypto;
    const commandId = cryptoService.randomUUIDv4.pipe(
      Effect.map((id) => CommandId.make(`branch-naming:${id}`)),
    );
    const waiting = new Set<ThreadId>();
    const git = yield* GitCore;
    const broadcaster = yield* Effect.serviceOption(VcsStatusBroadcaster);
    const naming = yield* BranchNamingService;
    const coordinator = yield* GitMutationCoordinator;
    const workers = new Set<ThreadId>();
    const rerun = new Map<ThreadId, { branch: string; oid: string } | undefined>();
    let started = false;
    const getThread = (id: ThreadId) =>
      query.getThreadDetailById(id, { activityKinds: [] }).pipe(Effect.map(Option.getOrUndefined));
    const update = (
      threadId: ThreadId,
      previous: BranchNamingOperation,
      patch: Partial<BranchNamingOperation>,
    ) =>
      Effect.gen(function* () {
        const operation = {
          ...previous,
          ...patch,
          revision: previous.revision + 1,
          updatedAt: DateTime.formatIso(yield* DateTime.now),
        };
        yield* engine.dispatch({
          type: "thread.branch-naming.set",
          commandId: yield* commandId,
          threadId,
          expectedRevision: previous.revision,
          operation,
        });
        if (operation.state === "waiting") waiting.add(threadId);
        else waiting.delete(threadId);
        return operation;
      });
    const linkedThreads = (model: OrchestrationReadModel, cwd: string, branch: string) =>
      Effect.gen(function* () {
        const result: OrchestrationThread[] = [];
        for (const thread of model.threads) {
          if (thread.deletedAt || thread.branch !== branch) continue;
          const path = cwdFor(thread, model);
          if (!path) continue;
          const root = yield* Effect.promise(() => NodeFSP.realpath(path).catch(() => null));
          if (root === cwd) result.push(thread);
        }
        return result;
      });
    const finish = (
      threadId: ThreadId,
      op: BranchNamingOperation,
      target: string,
      detail: string,
    ) =>
      Effect.gen(function* () {
        yield* update(threadId, op, { state: "completed", target, detail });
        if (op.repositoryKey) coordinator.unblock(op.repositoryKey);
        if (op.cwd && Option.isSome(broadcaster))
          yield* broadcaster.value.refreshStatus(op.cwd).pipe(Effect.ignoreCause({ log: true }));
      });
    const reconcile = (
      threadId: ThreadId,
      op: BranchNamingOperation,
      repair?: { branch: string; oid: string },
    ) =>
      Effect.gen(function* () {
        if (!op.cwd || !op.repositoryKey || !op.target || !op.oldOid) return;
        coordinator.block(op.repositoryKey);
        const actual = yield* readBranchIdentity(git, op.cwd);
        if (actual.repositoryKey !== op.repositoryKey || actual.cwd !== op.cwd)
          return yield* branchNamingError(
            "Repository identity changed; restore the original workspace before reconciliation.",
          );
        if (repair) {
          if (actual.branch !== repair.branch || actual.oid !== repair.oid)
            return yield* branchNamingError(
              "The displayed branch changed. Recheck branch state first.",
            );
          const model = yield* query.getCommandReadModel();
          const linked = yield* linkedThreads(model, op.cwd, op.expectedBranch);
          if (linked.some(busy))
            return yield* branchNamingError("Wait for all chats in this workspace to finish.");
          yield* finish(
            threadId,
            op,
            actual.branch,
            `Workspace metadata reconciled to ${actual.branch}. No Git refs were changed.`,
          );
          return;
        }
        const names = yield* git.listLocalBranchNames(op.cwd);
        const trackingMatches =
          actual.upstreamRemote === (op.upstreamRemote ?? null) &&
          actual.upstreamMerge === (op.upstreamMerge ?? null);
        const reflog = yield* git.execute({
          cwd: op.cwd,
          operation: "branchNaming.reconcile",
          args: ["reflog", "show", "-1", "--format=%gs", `refs/heads/${op.target}`],
          allowNonZeroExit: true,
        });
        const evidence =
          reflog.stdout.trim() ===
          `Branch: renamed refs/heads/${op.expectedBranch} to refs/heads/${op.target}`;
        if (
          !names.includes(op.expectedBranch) &&
          actual.branch === op.target &&
          actual.oid === op.oldOid &&
          trackingMatches &&
          evidence
        ) {
          yield* finish(
            threadId,
            op,
            op.target,
            `Local branch renamed: ${op.expectedBranch} → ${op.target}.${op.upstreamRemote ? ` Still tracking ${op.upstreamRemote}/${op.upstreamMerge?.replace(/^refs\/heads\//, "")}; remote branch and PR unchanged.` : ""}`,
          );
        } else if (
          actual.branch === op.expectedBranch &&
          actual.oid === op.oldOid &&
          !names.includes(op.target) &&
          trackingMatches
        ) {
          yield* update(threadId, op, {
            state: "failed",
            detail: "Rename did not complete. The original branch is intact; regenerate to retry.",
          });
          coordinator.unblock(op.repositoryKey);
        } else {
          yield* update(threadId, op, {
            state: "needs-attention",
            actualBranch: actual.branch,
            actualOid: actual.oid,
            detail: `Branch state needs reconciliation. Expected ${op.expectedBranch} → ${op.target}; current branch is ${actual.branch}.`,
          });
        }
      });
    const process = (id: ThreadId, repair?: { branch: string; oid: string }) =>
      Effect.gen(function* () {
        let thread = yield* getThread(id);
        let op = thread?.branchNaming;
        if (!thread || !op || !namingIsActive(op)) return;
        if (namingNeedsRecovery(op)) {
          if (op.cwd) yield* coordinator.withRepository(op.cwd, reconcile(id, op, repair), true);
          return;
        }
        let model = yield* query.getCommandReadModel();
        const cwd = cwdFor(thread, model);
        if (!cwd || thread.deletedAt || thread.archivedAt)
          return yield* branchNamingError("The chat workspace is unavailable.");
        if (op.state === "queued") {
          const identity = yield* checkBranchEligibility(git, cwd, op.expectedBranch);
          const linked = yield* linkedThreads(model, identity.cwd, op.expectedBranch);
          if (op.source === "regenerate" && linked.some(busy))
            return yield* branchNamingError(
              "Wait for the active turn to finish before regenerating.",
            );
          const watermark = branchNamingWatermark(thread.messages);
          op = yield* update(id, op, {
            state: "generating",
            repositoryKey: identity.repositoryKey,
            cwd: identity.cwd,
            sourceWorkspace: cwd,
            watermark,
          });

          const initialMessage = thread.messages.find((message) => message.role === "user");
          const message =
            op.source === "initial"
              ? assistantCitationsToPlainText(initialMessage?.text ?? "")
              : yield* Effect.try({
                  try: () => branchNamingContext(thread!.messages),
                  catch: (cause) => branchNamingError(String(cause)),
                });
          const generated = yield* naming.generate({
            cwd,
            message,
            projectId: thread.projectId,
            ...(op.source === "initial" && initialMessage?.attachments
              ? { attachments: initialMessage.attachments }
              : {}),
          });
          // Manual regeneration can supersede an automatic worker during the provider call.
          const current = (yield* getThread(id))?.branchNaming;
          if (current?.id !== op.id || current.revision !== op.revision) return;
          op = yield* update(id, op, {
            ...generated,
            state: "waiting",
            detail: "Branch name ready; waiting for the workspace to become idle.",
          });
        }
        if (op.state !== "waiting" || !op.cwd || !op.template || !op.slug) return;
        const candidate = op;
        yield* coordinator.withRepository(
          op.cwd,
          Effect.gen(function* () {
            model = yield* query.getCommandReadModel();
            thread = yield* getThread(id);
            if (
              !thread ||
              thread.branchNaming?.id !== candidate.id ||
              thread.branchNaming.revision !== candidate.revision
            )
              return;
            if (thread.deletedAt || thread.archivedAt)
              return yield* branchNamingError("The chat is no longer active.");
            if (branchNamingWatermark(thread.messages) !== candidate.watermark)
              return yield* branchNamingError(
                "New conversation input arrived. Regenerate using the latest request.",
              );
            if (candidate.sourceWorkspace && cwdFor(thread, model) !== candidate.sourceWorkspace)
              return yield* branchNamingError(
                "The chat workspace changed during generation. Regenerate in the current workspace.",
              );

            if ((yield* naming.fingerprint(thread.projectId)) !== candidate.fingerprint)
              return yield* branchNamingError(
                "Branch naming settings changed. Regenerate to use the new rules.",
              );
            const identity = yield* checkBranchEligibility(
              git,
              candidate.cwd!,
              candidate.expectedBranch,
            );
            if (
              identity.repositoryKey !== candidate.repositoryKey ||
              identity.cwd !== candidate.cwd
            )
              return yield* branchNamingError("Workspace identity changed.");
            const linked = yield* linkedThreads(model, identity.cwd, candidate.expectedBranch);
            if (linked.some(busy)) return;
            const target = yield* availableBranchName(
              git,
              identity.cwd,
              candidate.template!,
              candidate.slug!,
              candidate.expectedBranch,
              candidate.legacyBranch,
            );
            const prepared = {
              target,
              oldOid: identity.oid,
              upstreamRemote: identity.upstreamRemote,
              upstreamMerge: identity.upstreamMerge,
              affectedThreadIds: linked.map((t) => t.id),
            };
            if (target === candidate.expectedBranch) {
              yield* finish(
                id,
                { ...candidate, ...prepared },
                target,
                "Branch name is already up to date.",
              );
              return;
            }
            const durable = yield* update(id, candidate, {
              ...prepared,
              state: "prepared",
              detail: "Applying local branch rename…",
            });
            coordinator.block(identity.repositoryKey);
            // Never choose another name after persisting the exact target. Git cannot overwrite refs.
            yield* git
              .execute({
                cwd: identity.cwd,
                operation: "branchNaming.renameExact",
                args: ["branch", "-m", "--", candidate.expectedBranch, target],
              })
              .pipe(Effect.catch(() => Effect.void));
            yield* reconcile(id, durable);
          }),
        );
      });
    const safely = (id: ThreadId, repair?: { branch: string; oid: string }) =>
      Effect.gen(function* () {
        const operationId = (yield* getThread(id))?.branchNaming?.id;
        yield* process(id, repair).pipe(
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              if (Cause.hasInterruptsOnly(cause)) return;
              const thread = yield* getThread(id);
              const op = thread?.branchNaming;
              if (!op || op.id !== operationId || !namingIsActive(op)) return;
              const detail = Cause.pretty(cause).split("\n")[0] ?? "Branch naming failed.";
              yield* update(id, op, {
                state: namingNeedsRecovery(op) ? "needs-attention" : "failed",
                detail,
              }).pipe(Effect.ignore);
            }),
          ),
        );
      });
    const launch = (id: ThreadId, repair?: { branch: string; oid: string }) =>
      Effect.gen(function* () {
        if (workers.has(id)) {
          if (repair || !rerun.has(id)) rerun.set(id, repair);
          return;
        }
        workers.add(id);
        yield* Effect.gen(function* () {
          yield* safely(id, repair);
          while (rerun.has(id)) {
            const requestedRepair = rerun.get(id);
            rerun.delete(id);
            yield* safely(id, requestedRepair);
          }
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              workers.delete(id);
            }),
          ),
          Effect.forkScoped,
        );
      });
    return {
      start: () =>
        Effect.gen(function* () {
          if (started) return;
          started = true;
          // Subscribe before inspecting durable state. Event workers and startup deduplicate by thread.
          const events = yield* engine.subscribeDomainEvents;
          yield* Stream.runForEach(events, (event) =>
            Effect.gen(function* () {
              if (event.type === "thread.branch-naming-recovery-requested") {
                yield* launch(
                  event.payload.threadId,
                  event.payload.branch && event.payload.oid
                    ? { branch: event.payload.branch, oid: event.payload.oid }
                    : undefined,
                );
              } else if (
                event.type === "thread.branch-naming-updated" &&
                event.payload.operation.state === "queued"
              ) {
                yield* launch(event.payload.threadId);
              } else if (
                event.type === "thread.session-set" ||
                event.type === "thread.turn-diff-completed" ||
                event.type === "thread.meta-updated" ||
                event.type === "thread.archived" ||
                event.type === "thread.deleted"
              ) {
                for (const id of waiting) yield* launch(id);
              }
            }),
          ).pipe(Effect.forkScoped({ startImmediately: true }));
          const model = yield* query.getCommandReadModel();
          for (const thread of model.threads)
            if (namingNeedsRecovery(thread.branchNaming) && thread.branchNaming?.repositoryKey)
              coordinator.block(thread.branchNaming.repositoryKey);
          for (const thread of model.threads) {
            if (thread.branchNaming?.state === "waiting") waiting.add(thread.id);
            if (thread.branchNaming?.state === "generating")
              yield* update(thread.id, thread.branchNaming, {
                state: "failed",
                detail: "Generation was interrupted by restart. Regenerate to retry.",
              }).pipe(Effect.ignore);
            else if (namingIsActive(thread.branchNaming)) yield* launch(thread.id);
          }
        }).pipe(Effect.orDie),
    };
  }),
);

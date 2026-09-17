import * as NodeCrypto from "node:crypto";
import type { ChatAttachment, ProjectId } from "@t3tools/contracts";
import { TextGenerationError } from "@t3tools/contracts";
import { Context, Effect, Layer, Semaphore, Schema } from "effect";
import {
  normalizeBranchSlug,
  selectBranchNamingRule,
  validateBranchNamingPolicy,
} from "@t3tools/shared/branchNaming";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import {
  resolveSourceControlWriterModelSelection,
  ServerSettingsService,
} from "../serverSettings.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { TextGeneration } from "../textGeneration/TextGeneration.ts";
import { buildGeneratedWorktreeBranchName } from "./branchNamingLegacy.ts";

const encodeConfiguration = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

export class BranchNamingService extends Context.Service<
  BranchNamingService,
  {
    readonly fingerprint: (
      projectId?: ProjectId | null,
    ) => Effect.Effect<string, TextGenerationError>;
    readonly generate: (input: {
      cwd: string;
      message: string;
      projectId?: ProjectId | null;
      attachments?: readonly ChatAttachment[];
    }) => Effect.Effect<
      { template: string; slug: string; fingerprint: string; legacyBranch?: string },
      TextGenerationError
    >;
  }
>()("t3/git/BranchNamingService") {}

export const layer = Layer.effect(
  BranchNamingService,
  Effect.gen(function* () {
    const settingsService = yield* ServerSettingsService;
    const providers = yield* ProviderRegistry;
    const generation = yield* TextGeneration;
    const capacity = yield* Semaphore.make(2);
    const configuration = Effect.fn("branchNaming.configuration")(
      function* (projectId: ProjectId | null | undefined) {
        const settings = resolveProjectSettings(
          yield* settingsService.getSettings,
          projectId ?? null,
        ).settings;
        const modelSelection =
          settings.sourceControlWriterModelSelection === null
            ? settings.textGenerationModelSelection
            : resolveSourceControlWriterModelSelection(settings, yield* providers.getProviders);
        return {
          policy: settings.branchNaming,
          modelSelection,
          fingerprint: NodeCrypto.createHash("sha256")
            .update(yield* encodeConfiguration([settings.branchNaming, modelSelection]))
            .digest("hex"),
        };
      },
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation: "branchNaming",
            detail: "Could not read branch naming configuration.",
            cause,
          }),
      ),
    );
    return BranchNamingService.of({
      fingerprint: (projectId) =>
        configuration(projectId).pipe(Effect.map((config) => config.fingerprint)),
      generate: (input) =>
        capacity.withPermits(1)(
          Effect.gen(function* () {
            const config = yield* configuration(input.projectId);
            const error = validateBranchNamingPolicy(config.policy);
            if (error)
              return yield* new TextGenerationError({ operation: "branchNaming", detail: error });
            const result = yield* generation
              .generateBranchName({
                cwd: input.cwd,
                message: input.message,
                attachments: input.attachments,
                branchNamingPolicy: config.policy,
                modelSelection: config.modelSelection,
              })
              .pipe(
                Effect.timeoutOrElse({
                  duration: "60 seconds",
                  orElse: () =>
                    Effect.fail(
                      new TextGenerationError({
                        operation: "branchNaming",
                        detail: "Branch naming timed out. Regenerate to retry.",
                      }),
                    ),
                }),
              );
            return yield* Effect.try({
              try: () => ({
                template: config.policy
                  ? selectBranchNamingRule(config.policy, result.ruleId ?? null).template
                  : "t3code/{AI_MESSAGE}",
                slug: normalizeBranchSlug(config.policy ? (result.slug ?? "") : result.branch),
                fingerprint: config.fingerprint,
                ...(!config.policy
                  ? { legacyBranch: buildGeneratedWorktreeBranchName(result.branch) }
                  : {}),
              }),
              catch: (cause) =>
                new TextGenerationError({
                  operation: "branchNaming",
                  detail: cause instanceof Error ? cause.message : "Invalid generated branch name.",
                  cause,
                }),
            });
          }),
        ),
    });
  }),
);

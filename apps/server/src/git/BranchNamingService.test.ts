import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { DEFAULT_SERVER_SETTINGS, ProjectId } from "@t3tools/contracts";
import { BranchNamingService, layer } from "./BranchNamingService.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import {
  TextGeneration,
  type BranchNameGenerationInput,
} from "../textGeneration/TextGeneration.ts";

it.effect(
  "uses project rules and the selected model, validates rule IDs, and honors explicit opt-out",
  () =>
    Effect.gen(function* () {
      const globalPolicy = {
        rules: [{ id: "all", template: "Global/{AI_MESSAGE}", description: "All work" }],
        fallbackRuleId: null,
      };
      const projectPolicy = {
        rules: [
          { id: "fix", template: "Team/{AI_MESSAGE}-WIP", description: "Fixes" },
          { id: "test", template: "Tests/{AI_MESSAGE}", description: "Tests" },
        ],
        fallbackRuleId: null,
      };
      const inputs: BranchNameGenerationInput[] = [];
      let ruleId = "fix";
      const settingsLayer = Layer.mock(ServerSettingsService)({
        getSettings: Effect.succeed({
          ...DEFAULT_SERVER_SETTINGS,
          branchNaming: globalPolicy,
          projectSettingsOverrides: {
            project: { branchNaming: projectPolicy },
            plain: { branchNaming: null },
          },
        }),
      });
      yield* Effect.gen(function* () {
        const naming = yield* BranchNamingService;
        const global = yield* naming.generate({ cwd: "/repo", message: "Fix the importer" });
        const project = yield* naming.generate({
          cwd: "/repo",
          message: "Fix the importer",
          projectId: ProjectId.make("project"),
        });
        assert.equal(global.template, "Global/{AI_MESSAGE}");
        assert.equal(project.template, "Team/{AI_MESSAGE}-WIP");
        assert.equal(project.slug, "fix-importer");
        assert.notEqual(global.fingerprint, project.fingerprint);
        assert.deepEqual(inputs[1]?.branchNamingPolicy, projectPolicy);
        assert.deepEqual(
          inputs[1]?.modelSelection,
          DEFAULT_SERVER_SETTINGS.textGenerationModelSelection,
        );
        ruleId = "invented";
        assert.equal(
          (yield* naming
            .generate({ cwd: "/repo", message: "Fix", projectId: ProjectId.make("project") })
            .pipe(Effect.exit))._tag,
          "Failure",
        );
        const plain = yield* naming.generate({
          cwd: "/repo",
          message: "Fix",
          projectId: ProjectId.make("plain"),
        });
        assert.equal(plain.legacyBranch, "t3code/fix-importer");
      }).pipe(
        Effect.provide(
          layer.pipe(
            Layer.provide(settingsLayer),
            Layer.provide(Layer.mock(ProviderRegistry)({})),
            Layer.provide(
              Layer.mock(TextGeneration)({
                generateBranchName: (input) =>
                  Effect.sync(() => {
                    inputs.push(input);
                    return {
                      branch: "fix-importer",
                      slug: "Fix importer",
                      ruleId:
                        input.branchNamingPolicy?.rules.length === 1
                          ? input.branchNamingPolicy.rules[0]!.id
                          : ruleId,
                    };
                  }),
              }),
            ),
          ),
        ),
      );
    }),
);

import { repositoryBranchNamingPolicy } from "@t3tools/shared/branchNaming";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { expect } from "vite-plus/test";
import { DEFAULT_SERVER_SETTINGS, ProjectId } from "@t3tools/contracts";
import { GitVcsDriver, layer as gitLayer } from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as ServerConfig from "../config.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import {
  TextGeneration,
  type BranchNameGenerationInput,
} from "../textGeneration/TextGeneration.ts";
import { BranchNamingService, layer as namingLayer } from "./BranchNamingService.ts";
import { makeRepositoryConventionsReader } from "./repositoryConventions.ts";

const readRepositoryBranchNaming = Effect.fn(function* (git: GitVcsDriver["Service"], cwd: string) {
  return repositoryBranchNamingPolicy(
    (yield* (yield* makeRepositoryConventionsReader(git))(cwd)) ?? { version: 1 },
  );
});

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const conventions = {
  version: 1,
  branches: {
    description: "Choose the best task type.",
    template: "{type}/{slug}",
    types: { feat: "New functionality", fix: "Bug fixes", chore: "Maintenance" },
    slugPattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
  },
};
const testLayer = gitLayer.pipe(
  Layer.provide(VcsProcess.layer),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "conventions-test-config-" })),
  Layer.provideMerge(NodeServices.layer),
);
const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const git = yield* GitVcsDriver;
  const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "branch-conventions-" });
  const run = (args: string[]) => git.execute({ cwd, args, operation: "test" });
  yield* run(["init", "-q", "-b", "main"]);
  yield* run([
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--allow-empty",
    "-qm",
    "Initial",
  ]);
  return { fs, path, git, cwd, run, file: path.join(cwd, ".conventions.json") };
});

it.layer(testLayer)("repository conventions", (it) => {
  it.effect("finds the Git root from subdirectories and reads the current worktree's file", () =>
    Effect.gen(function* () {
      const { fs, path, git, cwd, run, file } = yield* fixture;
      const nested = path.join(cwd, "nested");
      yield* fs.makeDirectory(nested);
      expect(yield* readRepositoryBranchNaming(git, nested)).toBeNull();
      yield* fs.writeFileString(file, encodeJson(conventions));
      yield* fs.writeFileString(
        path.join(nested, ".conventions.json"),
        "invalid nested file is ignored",
      );
      expect((yield* readRepositoryBranchNaming(git, nested))?.rules[1]?.template).toBe(
        "fix/{AI_MESSAGE}",
      );
      yield* run(["add", ".conventions.json"]);
      yield* run([
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-qm",
        "Conventions",
      ]);
      const worktree = path.join(cwd, "linked");
      yield* run(["worktree", "add", "-qb", "feature", worktree]);
      yield* fs.writeFileString(
        path.join(worktree, ".conventions.json"),
        encodeJson({
          ...conventions,
          branches: { ...conventions.branches, template: "team/{type}/{slug}" },
        }),
      );
      expect((yield* readRepositoryBranchNaming(git, worktree))?.rules[1]?.template).toBe(
        "team/fix/{AI_MESSAGE}",
      );
      expect((yield* readRepositoryBranchNaming(git, cwd))?.rules[1]?.template).toBe(
        "fix/{AI_MESSAGE}",
      );
    }),
  );

  it.effect("does not silently fall back on malformed, unsupported, or oversized files", () =>
    Effect.gen(function* () {
      const { fs, git, cwd, file } = yield* fixture;
      for (const text of [
        "{",
        encodeJson({ ...conventions, version: 2 }),
        encodeJson({ ...conventions, branches: { ...conventions.branches, slugPattern: "[" } }),
        " ".repeat(65 * 1024),
      ]) {
        yield* fs.writeFileString(file, text);
        const error = yield* readRepositoryBranchNaming(git, cwd).pipe(Effect.flip);
        expect(error.message).toContain(".conventions.json");
      }
      yield* fs.writeFileString(
        file,
        encodeJson({ version: 1, otherSection: { description: "Unrelated" } }),
      );
      expect(yield* readRepositoryBranchNaming(git, cwd)).toBeNull();
    }),
  );

  it.effect(
    "overrides project settings, validates generated slugs, and invalidates pending names after edits or removal",
    () =>
      Effect.gen(function* () {
        const { fs, cwd, file } = yield* fixture;
        const inputs: BranchNameGenerationInput[] = [];
        const fallback = {
          rules: [{ id: "fallback", template: "fallback/{AI_MESSAGE}", description: "All" }],
          fallbackRuleId: null,
        };
        yield* fs.writeFileString(file, encodeJson(conventions));
        yield* Effect.gen(function* () {
          const naming = yield* BranchNamingService;
          const projectId = ProjectId.make("project");
          const generated = yield* naming.generate({
            cwd,
            projectId,
            message: "Fix header overflow",
          });
          expect(generated.template).toBe("fix/{AI_MESSAGE}");
          expect(generated.slug).toBe("header-overflow");
          expect(generated.slugPattern).toBe(conventions.branches.slugPattern);
          expect(inputs[0]?.branchNamingPolicy?.description).toBe(conventions.branches.description);
          expect(yield* naming.fingerprint(cwd, projectId)).toBe(generated.fingerprint);
          yield* fs.writeFileString(
            file,
            encodeJson({
              ...conventions,
              branches: { ...conventions.branches, slugPattern: "^ticket-[a-z-]+$" },
            }),
          );
          expect(yield* naming.fingerprint(cwd, projectId)).not.toBe(generated.fingerprint);
          const error = yield* naming
            .generate({ cwd, projectId, message: "Fix header overflow" })
            .pipe(Effect.flip);
          expect(error.message).toContain("slugPattern");
          yield* fs.remove(file);
          const fallbackName = yield* naming.generate({
            cwd,
            projectId,
            message: "Fix header overflow",
          });
          expect(fallbackName.template).toBe("fallback/{AI_MESSAGE}");
          expect(fallbackName.fingerprint).not.toBe(generated.fingerprint);
        }).pipe(
          Effect.provide(
            namingLayer.pipe(
              Layer.provide(
                Layer.mock(ServerSettingsService)({
                  getSettings: Effect.succeed({
                    ...DEFAULT_SERVER_SETTINGS,
                    projectSettingsOverrides: { project: { branchNaming: fallback } },
                  }),
                }),
              ),
              Layer.provide(Layer.mock(ProviderRegistry)({})),
              Layer.provide(
                Layer.mock(TextGeneration)({
                  generateBranchName: (input) =>
                    Effect.sync(() => {
                      inputs.push(input);
                      return {
                        branch: "header-overflow",
                        slug: "Header Overflow",
                        ruleId: input.branchNamingPolicy?.rules.length === 1 ? "fallback" : "fix",
                      };
                    }),
                }),
              ),
            ),
          ),
        );
      }),
  );
});

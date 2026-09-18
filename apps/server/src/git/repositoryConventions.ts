import { RepositoryConventions, TextGenerationError } from "@t3tools/contracts";
import { validateRepositoryConventions } from "@t3tools/shared/conventions";
import { Effect, FileSystem, Path, Schema } from "effect";
import type { GitVcsDriver } from "../vcs/GitVcsDriver.ts";

const decodeConventions = Schema.decodeUnknownEffect(Schema.fromJsonString(RepositoryConventions));

export const makeRepositoryConventionsReader = Effect.fn("conventions.makeRepositoryReader")(
  function* (git: GitVcsDriver["Service"]) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return Effect.fn("conventions.readRepositoryConventions")(
      function* (cwd: string) {
        const root = yield* git.execute({
          cwd,
          operation: "conventions.repositoryRoot",
          args: ["rev-parse", "--show-toplevel"],
        });
        const file = path.join(root.stdout.trim(), ".conventions.json");
        const info = yield* fs
          .stat(file)
          .pipe(
            Effect.catch((error) =>
              error.reason._tag === "NotFound" ? Effect.succeed(null) : Effect.fail(error),
            ),
          );
        if (info === null) return null;
        if (info.type !== "File" || info.size > FileSystem.Size(64 * 1024)) {
          return yield* new TextGenerationError({
            operation: "conventions",
            detail: ".conventions.json must be a regular file no larger than 64 KiB.",
          });
        }
        const conventions = yield* decodeConventions(yield* fs.readFileString(file));
        return yield* Effect.try({
          try: () => {
            validateRepositoryConventions(conventions);
            return conventions;
          },
          catch: (cause) =>
            new TextGenerationError({
              operation: "conventions",
              detail: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
      },
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation: "conventions",
            detail: `Could not use .conventions.json: ${cause.message}`,
            cause,
          }),
      ),
    );
  },
);

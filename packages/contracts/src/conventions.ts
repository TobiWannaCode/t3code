import { Schema } from "effect";

const Description = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4000));
const Template = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));
const Types = Schema.Record(
  Schema.String,
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1000)),
);
const Examples = Schema.optionalKey(
  Schema.Array(Schema.String.check(Schema.isMaxLength(500))).check(Schema.isMaxLength(20)),
);
export const BranchConventions = Schema.Struct({
  description: Description,
  template: Template,
  types: Types,
  slugPattern: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  examples: Examples,
});
export const CommitConventions = Schema.Struct({
  description: Description,
  template: Template,
  types: Types,
  scopes: Schema.optionalKey(
    Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(100),
    ),
  ),
  subjectMaxLength: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 })),
  examples: Examples,
});
export type CommitConventions = typeof CommitConventions.Type;
export const PullRequestConventions = Schema.Struct({
  description: Description,
  titleTemplate: Template,
  requiredSections: Schema.Record(Schema.String, Description),
  examples: Examples,
});
export type PullRequestConventions = typeof PullRequestConventions.Type;
export const RepositoryConventions = Schema.Struct({
  version: Schema.Literal(1),
  branches: Schema.optionalKey(BranchConventions),
  commits: Schema.optionalKey(CommitConventions),
  pullRequests: Schema.optionalKey(PullRequestConventions),
});
export type RepositoryConventions = typeof RepositoryConventions.Type;

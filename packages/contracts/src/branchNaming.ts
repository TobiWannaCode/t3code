import { Schema } from "effect";

export const BranchNamingRule = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  template: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  description: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1000)),
});
export type BranchNamingRule = typeof BranchNamingRule.Type;
export const BranchNamingPolicy = Schema.Struct({
  rules: Schema.Array(BranchNamingRule).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  fallbackRuleId: Schema.NullOr(Schema.String),
});
export type BranchNamingPolicy = typeof BranchNamingPolicy.Type;

// Latest operation is an event projection; older operations remain in the event log.
export const BranchNamingOperation = Schema.Struct({
  id: Schema.String,
  source: Schema.Literals(["initial", "regenerate"]),
  state: Schema.Literals([
    "queued",
    "generating",
    "waiting",
    "prepared",
    "completed",
    "failed",
    "needs-attention",
  ]),
  revision: Schema.Int,
  expectedBranch: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  repositoryKey: Schema.optional(Schema.String),
  cwd: Schema.optional(Schema.String),
  sourceWorkspace: Schema.optional(Schema.String),
  fingerprint: Schema.optional(Schema.String),
  watermark: Schema.optional(Schema.String),
  legacyBranch: Schema.optional(Schema.String),
  template: Schema.optional(Schema.String),
  slug: Schema.optional(Schema.String),
  target: Schema.optional(Schema.String),
  oldOid: Schema.optional(Schema.String),
  upstreamRemote: Schema.optional(Schema.NullOr(Schema.String)),
  upstreamMerge: Schema.optional(Schema.NullOr(Schema.String)),
  affectedThreadIds: Schema.optional(Schema.Array(Schema.String)),
  detail: Schema.optional(Schema.String),
  actualBranch: Schema.optional(Schema.String),
  actualOid: Schema.optional(Schema.String),
});
export type BranchNamingOperation = typeof BranchNamingOperation.Type;

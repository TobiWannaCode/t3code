import { describe, expect, it } from "vite-plus/test";
import {
  buildBranchNameCandidate,
  repositoryBranchNamingPolicy,
  parseBranchTemplate,
  validateBranchNamingPolicy,
  resolveBranchNamingPolicy,
  normalizeBranchSlug,
  selectBranchNamingRule,
} from "./branchNaming.ts";

const policy = {
  rules: [
    { id: "tests", template: "test/etl/banana/{AI_MESSAGE}", description: "ETL tests" },
    { id: "fix", template: "Bug/{AI_MESSAGE}-wip", description: "Regressions" },
  ],
  fallbackRuleId: null,
};
describe("branch naming policy", () => {
  it("preserves namespaces, literal case and suffixes through collisions", () => {
    expect(buildBranchNameCandidate("Team/{AI_MESSAGE}-WIP", "Fix café Import", 1)).toBe(
      "Team/fix-cafe-import-1-WIP",
    );
    expect(buildBranchNameCandidate("test/etl/banana/{AI_MESSAGE}", "validate import")).toBe(
      "test/etl/banana/validate-import",
    );
    expect(buildBranchNameCandidate("Préfixe/{AI_MESSAGE}", "ok")).toBe("Préfixe/ok");
  });
  it.each([
    "plain",
    "{AI_MESSAGE}/{AI_MESSAGE}",
    "{DATE}/{AI_MESSAGE}",
    ".bad/{AI_MESSAGE}",
    "bad..name/{AI_MESSAGE}",
    "bad.lock/{AI_MESSAGE}",
    "bad//{AI_MESSAGE}",
    "-bad/{AI_MESSAGE}",
    "@{-1}/{AI_MESSAGE}",
    "bad name/{AI_MESSAGE}",
    "bad\\name/{AI_MESSAGE}",
  ])("rejects invalid template %s", (template) => {
    expect(() => parseBranchTemplate(template)).toThrow();
  });
  it("bounds UTF-8 bytes and generated fragments without changing literals", () => {
    expect(() => parseBranchTemplate(`${"é".repeat(95)}/{AI_MESSAGE}`)).toThrow();
    const candidate = buildBranchNameCandidate(
      `${"a".repeat(180)}/{AI_MESSAGE}-end`,
      "z".repeat(64),
      100,
    );
    expect(new TextEncoder().encode(candidate).length).toBeLessThanOrEqual(240);
    expect(candidate.endsWith("-100-end")).toBe(true);
    expect(() => normalizeBranchSlug("!!!")).toThrow();
  });
  it("validates uniqueness, nonblank descriptions, and fallback references", () => {
    expect(validateBranchNamingPolicy(policy)).toBeNull();
    expect(
      validateBranchNamingPolicy({ ...policy, rules: [policy.rules[0]!, policy.rules[0]!] }),
    ).not.toBeNull();
    expect(validateBranchNamingPolicy({ ...policy, fallbackRuleId: "missing" })).not.toBeNull();
    expect(
      validateBranchNamingPolicy({
        ...policy,
        rules: [{ ...policy.rules[0]!, description: "  " }],
      }),
    ).not.toBeNull();
  });
  it("replaces rather than merges project policies and supports reset", () => {
    const override = { rules: [policy.rules[1]!], fallbackRuleId: null };
    expect(resolveBranchNamingPolicy(policy, override)).toEqual({
      source: "project",
      policy: override,
    });
    expect(resolveBranchNamingPolicy(policy, null).policy).toBe(policy);
    expect(resolveBranchNamingPolicy(null, null).source).toBe("legacy");
  });
  it("uses explicit fallback but rejects unknown model IDs", () => {
    expect(() => selectBranchNamingRule(policy, null)).toThrow("No branch rule matched");
    expect(selectBranchNamingRule({ ...policy, fallbackRuleId: "fix" }, null).id).toBe("fix");
    expect(() => selectBranchNamingRule({ ...policy, fallbackRuleId: "fix" }, "invented")).toThrow(
      "unknown rule ID",
    );
    expect(
      selectBranchNamingRule({ rules: [policy.rules[0]!], fallbackRuleId: null }, null).id,
    ).toBe("tests");
  });
});

const conventions = {
  version: 1 as const,
  branches: {
    description: "Choose the type that best matches the task.",
    template: "{type}/{slug}",
    types: { feat: "New functionality", fix: "Bug fixes", chore: "Maintenance" },
    slugPattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
  },
};

it("translates repository conventions and renders the selected type with a collision suffix", () => {
  const policy = repositoryBranchNamingPolicy(conventions)!;
  const rule = selectBranchNamingRule(policy, "fix");
  expect(buildBranchNameCandidate(rule.template, "Header overflow", 1, policy.slugPattern)).toBe(
    "fix/header-overflow-1",
  );
  expect(policy.description).toBe(conventions.branches.description);
  expect(() => selectBranchNamingRule(policy, "unknown")).toThrow("unknown rule ID");
  expect(repositoryBranchNamingPolicy({ version: 1 })).toBeNull();
});

it.each([
  { template: "{type}/{slug}/{slug}" },
  { template: "{type}/{ticket}/{slug}" },
  { template: "{slug}" },
  { template: "refs/../{type}/{slug}" },
  { types: {} },
  { types: { "Bad Type": "Invalid" } },
  { slugPattern: "[" },
])("rejects invalid repository branch configuration %j", (change) => {
  expect(() =>
    repositoryBranchNamingPolicy({
      ...conventions,
      branches: { ...conventions.branches, ...change },
    }),
  ).toThrow();
});

it("validates the final slug after normalization, truncation, and collision suffixes", () => {
  expect(
    buildBranchNameCandidate("fix/{AI_MESSAGE}", "Header Overflow", 0, "^header-overflow$"),
  ).toBe("fix/header-overflow");
  expect(() =>
    buildBranchNameCandidate("fix/{AI_MESSAGE}", "Header Overflow", 1, "^header-overflow$"),
  ).toThrow("slugPattern");
  expect(() => buildBranchNameCandidate("fix/{AI_MESSAGE}", "a".repeat(65), 0, "^a{65}$")).toThrow(
    "slugPattern",
  );
});

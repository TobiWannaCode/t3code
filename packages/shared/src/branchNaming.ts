import type { BranchNamingPolicy } from "@t3tools/contracts";

const TOKEN = "{AI_MESSAGE}";
const bytes = (value: string) => new TextEncoder().encode(value).length;

export function validateBranchName(name: string): string | null {
  if (
    !name ||
    name === "@" ||
    name.startsWith("-") ||
    name.endsWith(".") ||
    [...name].some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127) ||
    /[~^:?*[\\]/u.test(name) ||
    name.includes("..") ||
    name.includes("@{")
  ) {
    return "Invalid Git branch name.";
  }
  if (name.split("/").some((part) => !part || part.startsWith(".") || part.endsWith(".lock"))) {
    return "Branch segments cannot be empty, start with a dot, or end with .lock.";
  }
  return bytes(name) > 240 ? "Branch names must fit within 240 UTF-8 bytes." : null;
}

export function parseBranchTemplate(template: string): { prefix: string; suffix: string } {
  const parts = template.split(TOKEN);
  if (parts.length !== 2 || /[{}]/u.test(parts.join(""))) {
    throw new Error("Use exactly one {AI_MESSAGE} token and no other tokens.");
  }
  if (template.length > 200 || bytes(template) > 200) {
    throw new Error("Formats must fit within 200 characters and 200 UTF-8 bytes.");
  }
  const [prefix = "", suffix = ""] = parts;
  const error = validateBranchName(`${prefix}example-change-100${suffix}`);
  if (error) throw new Error(error);
  return { prefix, suffix };
}

export function validateBranchNamingPolicy(policy: BranchNamingPolicy | null): string | null {
  if (!policy) return null;
  if (policy.rules.length < 1 || policy.rules.length > 50) return "Add between 1 and 50 rules.";
  const ids = new Set<string>();
  const templates = new Set<string>();
  for (const [index, rule] of policy.rules.entries()) {
    try {
      if (!rule.id.trim() || rule.id.length > 128 || ids.has(rule.id))
        throw new Error("Rule IDs must be unique.");
      if (!rule.description.trim() || rule.description.length > 1000)
        throw new Error("Describe when to use this rule (1–1,000 characters).");
      if (templates.has(rule.template)) throw new Error("Each format must be unique.");
      parseBranchTemplate(rule.template);
      ids.add(rule.id);
      templates.add(rule.template);
    } catch (error) {
      return `Rule ${index + 1}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  return policy.fallbackRuleId !== null && !ids.has(policy.fallbackRuleId)
    ? "The fallback must reference an existing rule."
    : null;
}

export function normalizeBranchSlug(value: string): string {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  if (!slug) throw new Error("The generated branch description is empty.");
  return slug;
}

export function buildBranchNameCandidate(
  template: string,
  slug: string,
  collisionIndex = 0,
): string {
  const { prefix, suffix } = parseBranchTemplate(template);
  if (!Number.isInteger(collisionIndex) || collisionIndex < 0 || collisionIndex > 100)
    throw new Error("Invalid collision index.");
  const collision = collisionIndex ? `-${collisionIndex}` : "";
  const limit = Math.min(64 - collision.length, 240 - bytes(prefix + suffix) - collision.length);
  const fragment = normalizeBranchSlug(slug).slice(0, limit).replace(/-+$/g, "");
  if (!fragment) throw new Error("The format leaves no room for a branch description.");
  const name = `${prefix}${fragment}${collision}${suffix}`;
  const error = validateBranchName(name);
  if (error) throw new Error(error);
  return name;
}
export const renderBranchTemplate = (template: string, slug: string) =>
  buildBranchNameCandidate(template, slug);

export function resolveBranchNamingPolicy(
  global: BranchNamingPolicy | null,
  override?: BranchNamingPolicy | null,
) {
  return {
    policy: override ?? global,
    source: override ? "project" : global ? "global" : "legacy",
  } as const;
}

export function selectBranchNamingRule(policy: BranchNamingPolicy, ruleId: string | null) {
  const error = validateBranchNamingPolicy(policy);
  if (error) throw new Error(error);
  if (ruleId !== null && !policy.rules.some((rule) => rule.id === ruleId))
    throw new Error("The model returned an unknown rule ID.");
  const id = policy.rules.length === 1 ? policy.rules[0]!.id : (ruleId ?? policy.fallbackRuleId);
  const rule = policy.rules.find((rule) => rule.id === id);
  if (!rule)
    throw new Error(
      "No branch rule matched. Configure a fallback or adjust the rule descriptions.",
    );
  return rule;
}

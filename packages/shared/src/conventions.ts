import type {
  CommitConventions,
  PullRequestConventions,
  RepositoryConventions,
} from "@t3tools/contracts";
import { repositoryBranchNamingPolicy } from "./branchNaming.ts";

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function titlePattern(template: string) {
  const tokens = [...template.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]!);
  if (
    tokens.filter((token) => token === "subject").length !== 1 ||
    new Set(tokens).size !== tokens.length ||
    tokens.some((token) => !["type", "scope", "subject"].includes(token)) ||
    /[{}\r\n]/.test(template.replace(/\{[^{}]+\}/g, ""))
  ) {
    throw new Error(
      "Title templates require exactly one {subject}, optional {type} and {scope}, and no other tokens or newlines.",
    );
  }
  return new RegExp(
    `^${template
      .split(/(\{(?:type|scope|subject)\})/g)
      .map((part) => {
        const token = /^\{(type|scope|subject)\}$/.exec(part)?.[1];
        return token
          ? `(?<${token}>${token === "subject" ? ".+?" : "[a-z0-9][a-z0-9-]*"})`
          : escapeRegex(part);
      })
      .join("")}$`,
    "u",
  );
}

function validateNames(names: string[], label: string, maximum: number) {
  if (
    !names.length ||
    names.length > maximum ||
    new Set(names).size !== names.length ||
    names.some((name) => !/^[a-z0-9][a-z0-9-]*$/.test(name))
  ) {
    throw new Error(
      `${label} must contain 1–${maximum} unique lowercase names using letters, digits, and hyphens.`,
    );
  }
}

export function validateRepositoryConventions(conventions: RepositoryConventions): void {
  repositoryBranchNamingPolicy(conventions);
  const commits = conventions.commits;
  if (commits) {
    titlePattern(commits.template);
    if (!commits.template.includes("{type}"))
      throw new Error("The commit template requires {type}.");
    validateNames(Object.keys(commits.types), "Commit types", 50);
    if (commits.scopes) validateNames([...commits.scopes], "Commit scopes", 100);
    if (commits.template.includes("{scope}") && !commits.scopes)
      throw new Error("Define commit scopes when the template includes {scope}.");
  }
  const pr = conventions.pullRequests;
  if (pr) {
    titlePattern(pr.titleTemplate);
    if (pr.titleTemplate.includes("{type}") && !commits)
      throw new Error("Pull request titles using {type} require commit types.");
    if (pr.titleTemplate.includes("{scope}") && !commits?.scopes)
      throw new Error("Pull request titles using {scope} require commit scopes.");
    const sections = Object.keys(pr.requiredSections);
    if (
      !sections.length ||
      sections.length > 20 ||
      sections.some(
        (section) =>
          !section.trim() ||
          section !== section.trim() ||
          /[\r\n#]/.test(section) ||
          section.length > 128,
      )
    ) {
      throw new Error(
        "Define 1–20 named pull request sections without heading markers or newlines.",
      );
    }
  }
}

function validateTitle(title: string, template: string, commits?: CommitConventions): void {
  const values = titlePattern(template).exec(title)?.groups;
  if (!values || /[\r\n]/.test(title) || title !== title.trim())
    throw new Error(`The generated title must match ${template}.`);
  if (values.type && (!commits || !Object.hasOwn(commits.types, values.type)))
    throw new Error("The generated title uses a type not listed in .conventions.json.");
  if (values.scope && !commits?.scopes?.includes(values.scope))
    throw new Error("The generated title uses a scope not listed in .conventions.json.");
  const subject = values.subject!;
  if (!subject.trim() || subject !== subject.trim())
    throw new Error("The generated subject must not be empty or padded with whitespace.");
  if (commits && [...subject].length > commits.subjectMaxLength)
    throw new Error(
      `The generated subject exceeds subjectMaxLength (${commits.subjectMaxLength}).`,
    );
}

export function validateConventionalCommit(title: string, conventions: CommitConventions): void {
  validateTitle(title, conventions.template, conventions);
}

export function validateConventionalPullRequest(
  content: { title: string; body: string },
  conventions: PullRequestConventions,
  commits?: CommitConventions,
): void {
  validateTitle(content.title, conventions.titleTemplate, commits);
  const sections = new Map<string, string[]>();
  const stack: { level: number; lines: string[] }[] = [];
  let fence: { marker: string; length: number } | undefined;
  let comment = false;
  for (const line of content.body.split(/\r?\n/)) {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (
        fenceMatch &&
        fenceMatch[1]![0] === fence.marker &&
        fenceMatch[1]!.length >= fence.length &&
        line.slice(fenceMatch[0].length).trim() === ""
      )
        fence = undefined;
      else if (line.trim()) for (const section of stack) section.lines.push(line.trim());
      continue;
    }
    if (fenceMatch) {
      fence = { marker: fenceMatch[1]![0]!, length: fenceMatch[1]!.length };
      continue;
    }
    if (line.includes("<!--")) comment = true;
    if (comment) {
      if (line.includes("-->")) comment = false;
      continue;
    }
    const heading = /^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      while (stack.length && stack[stack.length - 1]!.level >= level) stack.pop();
      const lines = sections.get(heading[2]!) ?? [];
      sections.set(heading[2]!, lines);
      stack.push({ level, lines });
    } else if (line.trim()) for (const section of stack) section.lines.push(line.trim());
  }
  for (const name of Object.keys(conventions.requiredSections)) {
    if (!sections.get(name)?.length)
      throw new Error(`The generated pull request body requires a nonempty "${name}" section.`);
  }
}

import { describe, expect, it } from "vite-plus/test";
import {
  validateRepositoryConventions,
  validateConventionalCommit,
  validateConventionalPullRequest,
} from "./conventions.ts";

const commits = {
  description: "Use the imperative mood",
  template: "{type}({scope}): {subject}",
  types: { feat: "New functionality", fix: "Bug fixes" },
  scopes: ["web", "server"],
  subjectMaxLength: 72,
};
const pullRequests = {
  description: "Describe the final change",
  titleTemplate: commits.template,
  requiredSections: {
    Summary: "Explain the problem and result",
    Validation: "Describe checks and gaps",
  },
};
const content = {
  title: "fix(web): preserve draft",
  body: "## Summary\nPreserve the draft after reconnecting.\n## Validation\nTests passed.",
};

describe("repository conventions", () => {
  it("validates the sample structure and counts subject length without the type and scope", () => {
    expect(() =>
      validateRepositoryConventions({ version: 1, commits, pullRequests }),
    ).not.toThrow();
    expect(() =>
      validateConventionalCommit(`feat(server): ${"a".repeat(72)}`, commits),
    ).not.toThrow();
    expect(() => validateConventionalCommit(`feat(server): ${"a".repeat(73)}`, commits)).toThrow(
      "subjectMaxLength",
    );
    expect(() =>
      validateConventionalCommit("fix: preserve draft", {
        ...commits,
        template: "{type}: {subject}",
      }),
    ).not.toThrow();
  });
  it.each([
    "fix(desktop): preserve draft",
    "chore(web): update files",
    "fix(web): ",
    "fix(web): preserve draft\nsecond line",
    "fix[web]: preserve draft",
  ])("rejects invalid generated titles: %s", (title) => {
    expect(() => validateConventionalCommit(title, commits)).toThrow();
  });
  it("treats template punctuation literally", () => {
    const custom = { ...commits, template: "[{type}] {scope} + {subject}." };
    expect(() => validateConventionalCommit("[fix] web + preserve draft.", custom)).not.toThrow();
    expect(() => validateConventionalCommit("f web preserve draftx", custom)).toThrow();
  });
  it.each([
    "{type}: {unknown}",
    "{type}: {subject} {subject}",
    "{type}: {subject}\n",
    "{scope}: {subject}",
  ])("rejects malformed templates: %s", (template) => {
    expect(() =>
      validateRepositoryConventions({ version: 1, commits: { ...commits, template } }),
    ).toThrow();
  });
  it("requires commit rules when PR titles reference their types or scopes", () => {
    expect(() => validateRepositoryConventions({ version: 1, pullRequests })).toThrow(
      "commit types",
    );
    expect(() =>
      validateRepositoryConventions({
        version: 1,
        pullRequests: { ...pullRequests, titleTemplate: "{subject}" },
      }),
    ).not.toThrow();
  });
  it("accepts required sections, including nested content and code", () => {
    expect(() => validateConventionalPullRequest(content, pullRequests, commits)).not.toThrow();
    expect(() =>
      validateConventionalPullRequest(
        {
          ...content,
          body: "## Summary\n### Details\nDraft preserved.\n## Validation\n```sh\nbun run test\n```",
        },
        pullRequests,
        commits,
      ),
    ).not.toThrow();
  });
  it.each([
    "## Summary\nA change.\n## Testing\nPassed.",
    "## Summary\nA change.\n## Validation\n<!-- TODO -->",
    "## Summary\nA change.\n```md\n## Validation\nPassed.\n```",
  ])("rejects missing, empty, or fenced fake sections", (body) => {
    expect(() =>
      validateConventionalPullRequest({ ...content, body }, pullRequests, commits),
    ).toThrow('"Validation" section');
  });
  it("validates PR title types, scopes and subject length", () => {
    expect(() =>
      validateConventionalPullRequest(
        { ...content, title: "fix(other): preserve draft" },
        pullRequests,
        commits,
      ),
    ).toThrow("scope");
    expect(() =>
      validateConventionalPullRequest(
        { ...content, title: `fix(web): ${"a".repeat(73)}` },
        pullRequests,
        commits,
      ),
    ).toThrow("subjectMaxLength");
  });
});

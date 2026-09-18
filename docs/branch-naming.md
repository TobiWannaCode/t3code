# Repository conventions in the Local build

Add `.conventions.json` to the Git repository root to share branch, commit, and pull request conventions with the project:

```json
{
  "version": 1,
  "branches": {
    "description": "Choose the type that best matches the task and a short, descriptive slug. Use lowercase words separated by hyphens.",
    "template": "{type}/{slug}",
    "types": { "feat": "New functionality", "fix": "Bug fixes", "chore": "Maintenance" },
    "slugPattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$",
    "examples": ["feat/add-login", "fix/header-overflow", "chore/update-dependencies"]
  },
  "commits": {
    "description": "Describe the resulting change in the imperative mood. Choose the most specific scope that covers the change.",
    "template": "{type}({scope}): {subject}",
    "types": {
      "feat": "New functionality",
      "fix": "Bug fixes",
      "docs": "Documentation",
      "refactor": "Code restructuring without changing behavior",
      "test": "Test additions or corrections",
      "chore": "Maintenance"
    },
    "scopes": ["web", "server", "desktop", "mobile", "shared"],
    "subjectMaxLength": 72,
    "examples": ["fix(mobile): preserve draft when reconnecting"]
  },
  "pullRequests": {
    "description": "Describe the final change so a reviewer can understand it without reading the conversation. Explain the problem, resulting behavior, and verification.",
    "titleTemplate": "{type}({scope}): {subject}",
    "requiredSections": {
      "Summary": "Explain the problem and what changes.",
      "Validation": "Describe checks and their results. State verification gaps."
    },
    "examples": ["feat(web): add project search"]
  }
}
```

Each repository section takes priority over its corresponding T3 Code settings. All sections are optional; omitted sections retain their existing fallback behavior. Detection uses the current Git worktree root, including when the chat starts in a subdirectory. Commit the file to make it available in new worktrees. Changes take effect on the next naming request; pending names are rejected if the effective rules change before renaming.

Version 1 requires a description, a template with exactly one `{type}` and one `{slug}`, 1–50 types, and a JavaScript regular expression for `slugPattern`. Types use lowercase letters, digits, and hyphens, starting with a letter. The generated slug is normalized to lowercase ASCII kebab-case and must match the pattern, including any collision suffix. Invalid files, unsupported versions, or nonmatching names leave the branch unchanged and report an error. The file must fit within 64 KiB. Unknown top-level sections are ignored.

Commit templates use `{type}` and `{subject}`, with an optional `{scope}` token. Including `{scope}` requires a value from `scopes`; omit the token to allow unscoped titles. `subjectMaxLength` limits only the descriptive `{subject}` fragment, excluding fixed template text and the type/scope. Pull request title types, scopes, and subject limits reuse the commit rules; PR titles using `{type}` or `{scope}` require those commit definitions. Required PR sections must be Markdown headings with content. Existing repository PR templates remain available, and convention-required sections take priority.

Examples guide the model. T3 validates generated titles and required sections before creating commits or PRs; invalid generated content reports an error rather than silently truncating or publishing it. Explicitly supplied commit messages remain under your control. These rules apply across the source-control writer providers. They do not enforce conventions on external Git commands.

To share the rules with coding agents, add this to `AGENTS.md`:

```md
Read .conventions.json before naming branches, writing commit messages,
or preparing pull requests. Follow its applicable conventions.
```

Open **Settings → Conventions** for repository guidance, branch format fallbacks, commit/PR writing style, PR template behavior, and the writer model. If the file or a section is absent, existing settings apply. Use the settings scope selector to choose environment defaults or project overrides. The row's inheritance control resets a project to its environment defaults.

Formats such as `bug/{AI_MESSAGE}`, `test/etl/banana/{AI_MESSAGE}`, and `Team/{AI_MESSAGE}-WIP` contain exactly one case-sensitive token. Fixed text is preserved. The model selects a rule using its description, with earlier rules winning ties, and supplies a lowercase ASCII kebab-case description. A fallback rule is optional; an unmatched request without a fallback leaves the branch unchanged.

Use **Save** to persist the complete policy. Failed saves preserve the draft. Disabling custom formats restores the existing conventions for the selected scope when no repository branch rules are present. Formats are limited to 200 UTF-8 bytes, descriptions to 1,000 characters, and policies to 50 rules. Generated fragments are limited to 64 characters and complete names to 240 bytes. Collision suffixes go inside the token: `Team/fix-import-1-WIP`.

New worktrees retain their provisional name while the first turn runs. The generated name applies when the workspace is idle. From the thread's sidebar context menu or chat header menu, open **Branch naming…**, then **Regenerate branch name** to use the original request and recent conversation. Git actions that create an AI-named branch use the same effective policy, including when you supply a commit message.

Renames preserve commits, dirty files, worktree directories, and upstream tracking. Remote branches and existing PRs keep their names. Chats sharing the workspace are updated together, including archived chats; matching unsent drafts update within the same environment. Default branches, active turns, mismatched workspaces, and in-progress Git operations prevent renaming.

Progress survives restart. If generation is interrupted, regenerate explicitly. If Git may have renamed the branch before metadata was saved, the server reconciles the recorded branch, commit, tracking, and reflog. Conflicting evidence blocks workspace mutations until resolved. The dialog offers **Recheck branch state** and a confirmed **Use current branch for this workspace** metadata repair.

The rule editor and manual actions are available on web and desktop. Automatic naming runs server-side for all clients; mobile receives the updated branch through its shared state but has no new rule editor or recovery dialog.

## Local installation

Use Node 24.13.1 or newer compatible Node 24, install dependencies with the repository's pnpm 11.10.0/Vite+ tooling, then run:

```sh
bun run install:desktop:local
```

This builds current sources, verifies the packaged app, replaces **T3 Code (Local)**, and launches it. It closes the previous Local app only after the build passes its packaging checks. The macOS Local app stays on manual updates; rerun the command after changing code. Linux Local AppImage releases check `TobiWannaCode/t3code` on GitHub for updates and keep the same isolated Local data folders. The earlier Linux preview had updates disabled and needs one manual replacement with an update-enabled AppImage. Run the AppImage itself for automatic updates; an extracted copy does not update automatically.

This migration is based on upstream v0.0.42 at `f17165a76b1a782831eb6a05a4383b27283df15d`. Its server data lives in `~/.t3-local-current` and its Electron profile is `~/Library/Application Support/t3code-local-current`. Alpha's app and `~/.t3/userdata` are separate. Old Local data in `~/.t3-local` is unused. Migration `053_BranchNaming` stores durable rename operations; do not point the April v0.0.15 build at this new database.

### Linux fork releases

Build on Linux with the same Node/pnpm tooling, Rust, and native build dependencies:

```sh
bun run dist:desktop:artifact --platform linux --target AppImage --arch x64 --local-test --build-version 0.0.43 --output-dir release
```

Use a higher version for each release. Upload the AppImage and generated `latest-linux.yml` together to a published, non-prerelease GitHub release in `TobiWannaCode/t3code`, and mark it as latest. Use a `fork-linux-` tag prefix to avoid triggering the upstream multi-platform release workflow. Keep the metadata filename and asset filenames unchanged. The Local Linux feed is pinned to this fork even when the build environment names another repository.

The update button checks the release metadata, downloads the new AppImage, and applies it on restart. Source commits alone do not ship updates. The original `0.0.42-local.20260917` preview requires one manual install of a newer release before this works.

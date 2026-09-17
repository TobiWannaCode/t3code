# Branch naming in the Local build

Open **Settings → Source control → Branch naming rules**. Use the settings scope selector to choose environment defaults or project overrides. The row's inheritance control resets a project to its environment defaults.

Formats such as `bug/{AI_MESSAGE}`, `test/etl/banana/{AI_MESSAGE}`, and `Team/{AI_MESSAGE}-WIP` contain exactly one case-sensitive token. Fixed text is preserved. The model selects a rule using its description, with earlier rules winning ties, and supplies a lowercase ASCII kebab-case description. A fallback rule is optional; an unmatched request without a fallback leaves the branch unchanged.

Use **Save** to persist the complete policy. Failed saves preserve the draft. Disabling custom formats restores the existing conventions for the selected scope. Formats are limited to 200 UTF-8 bytes, descriptions to 1,000 characters, and policies to 50 rules. Generated fragments are limited to 64 characters and complete names to 240 bytes. Collision suffixes go inside the token: `Team/fix-import-1-WIP`.

New worktrees retain their provisional name while the first turn runs. The generated name applies when the workspace is idle. From the thread's sidebar context menu or chat header menu, open **Branch naming…**, then **Regenerate branch name** to use the original request and recent conversation. Git actions that create an AI-named branch use the same effective policy, including when you supply a commit message.

Renames preserve commits, dirty files, worktree directories, and upstream tracking. Remote branches and existing PRs keep their names. Chats sharing the workspace are updated together, including archived chats; matching unsent drafts update within the same environment. Default branches, active turns, mismatched workspaces, and in-progress Git operations prevent renaming.

Progress survives restart. If generation is interrupted, regenerate explicitly. If Git may have renamed the branch before metadata was saved, the server reconciles the recorded branch, commit, tracking, and reflog. Conflicting evidence blocks workspace mutations until resolved. The dialog offers **Recheck branch state** and a confirmed **Use current branch for this workspace** metadata repair.

The rule editor and manual actions are available on web and desktop. Automatic naming runs server-side for all clients; mobile receives the updated branch through its shared state but has no new rule editor or recovery dialog.

## Local installation

Use Node 24.13.1 or newer compatible Node 24, install dependencies with the repository's pnpm 11.10.0/Vite+ tooling, then run:

```sh
bun run install:desktop:local
```

This builds current sources, verifies the packaged app, replaces **T3 Code (Local)**, and launches it. It closes the previous Local app only after the build passes its packaging checks. The local app does not download upstream updates; rerun the command after changing code.

This migration is based on upstream v0.0.42 at `f17165a76b1a782831eb6a05a4383b27283df15d`. Its server data lives in `~/.t3-local-current` and its Electron profile is `~/Library/Application Support/t3code-local-current`. Alpha's app and `~/.t3/userdata` are separate. Old Local data in `~/.t3-local` is unused. Migration `053_BranchNaming` stores durable rename operations; do not point the April v0.0.15 build at this new database.

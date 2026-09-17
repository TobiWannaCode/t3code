import { threadDropAssignment } from "./drag";
import { describe, expect, it } from "vite-plus/test";
import {
  ChatFolderId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ChatOrganization,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { flattenExplorer, folderKey } from "./model";
const env = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const folder = (id: string, parentId: string | null, position = 0) => ({
  id: ChatFolderId.make(id),
  parentId: parentId ? ChatFolderId.make(parentId) : null,
  name: id,
  position,
  createdAt: "now",
  updatedAt: "now",
});
const thread = (id: string, environmentId = env): EnvironmentThreadShell => ({
  id: ThreadId.make(id),
  environmentId,
  projectId: ProjectId.make("project"),
  title: id,
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: "now",
  updatedAt: "now",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  pullRequests: [],
  session: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
});
describe("explorer visible traversal", () => {
  it("keeps scoped identities and excludes collapsed descendants from keyboard/range order", () => {
    const organization: ChatOrganization = {
      revision: 1,
      folders: [folder("root", null), folder("child", "root")],
      memberships: [{ threadId: ThreadId.make("same"), folderId: ChatFolderId.make("child") }],
    };
    const environments = [
      { id: env, organization, writable: true },
      { id: remote, organization: { revision: 0, folders: [], memberships: [] }, writable: false },
    ];
    const threads = [thread("same"), thread("same", remote), thread("unfiled")];
    const expanded = flattenExplorer(environments, threads, {});
    expect(expanded.filter((node) => node.kind === "thread").map((node) => node.key)).toEqual([
      "local:same",
      "local:unfiled",
      "remote:same",
    ]);
    const collapsed = flattenExplorer(environments, threads, {
      [folderKey(env, ChatFolderId.make("root"))]: true,
    });
    expect(collapsed.filter((node) => node.kind === "thread").map((node) => node.key)).toEqual([
      "local:unfiled",
      "remote:same",
    ]);
  });
  it("shows chats with missing folder references in Unfiled", () => {
    const organization = {
      revision: 1,
      folders: [],
      memberships: [{ threadId: ThreadId.make("chat"), folderId: ChatFolderId.make("gone") }],
    };
    const rows = flattenExplorer([{ id: env, organization, writable: true }], [thread("chat")], {});
    expect(rows.find((row) => row.kind === "thread")?.parentKey).toBe(folderKey(env, null));
  });
  it("keeps chats visible when cached folders have cycles or missing parents", () => {
    const organization = {
      revision: 1,
      folders: [folder("a", "b"), folder("b", "a"), folder("orphan", "gone")],
      memberships: [
        { threadId: ThreadId.make("chat"), folderId: ChatFolderId.make("a") },
        { threadId: ThreadId.make("other"), folderId: ChatFolderId.make("orphan") },
      ],
    };
    const rows = flattenExplorer(
      [{ id: env, organization, writable: false }],
      [thread("chat"), thread("other")],
      {},
    );
    expect(rows.filter((row) => row.kind === "thread").map((row) => row.parentKey)).toEqual([
      folderKey(env, null),
      folderKey(env, null),
    ]);
  });
  it("flattens a 10k-chat/1k-folder fixture while collapsed folders keep navigation bounded", () => {
    const threads = Array.from({ length: 10000 }, (_, i) => thread(`chat-${i}`));
    const folders = Array.from({ length: 1000 }, (_, i) => folder(`folder-${i}`, null, i));
    const organization = {
      revision: 1,
      folders,
      memberships: threads.map((entry, i) => ({
        threadId: entry.id,
        folderId: folders[i % 1000]!.id,
      })),
    };
    const collapsed = Object.fromEntries(folders.map((entry) => [folderKey(env, entry.id), true]));
    const rows = flattenExplorer([{ id: env, organization, writable: true }], threads, collapsed);
    expect(rows).toHaveLength(1002);
    expect(rows.some((row) => row.kind === "thread")).toBe(false);
    expect(flattenExplorer([{ id: env, organization, writable: true }], threads, {})).toHaveLength(
      11002,
    );
  });
});

it("inserts a moved selection into the exact folder slot and honors saved order", () => {
  const chats = [thread("first"), thread("second"), thread("moving"), thread("also-moving")];
  const organization: ChatOrganization = {
    revision: 0,
    folders: [folder("group", null)],
    memberships: chats
      .slice(0, 2)
      .map((chat) => ({ threadId: chat.id, folderId: ChatFolderId.make("group") })),
  };
  const node = flattenExplorer([{ id: env, organization, writable: true }], chats, {}).find(
    (node) => node.kind === "thread" && node.thread.id === "second",
  )!;
  const move = threadDropAssignment(
    [chats[2]!.id, chats[3]!.id],
    node,
    organization,
    chats,
    "before",
  );
  expect(move.folderId).toBe("group");
  expect(move.orderedThreadIds).toEqual(["first", "moving", "also-moving", "second"]);
  expect(
    threadDropAssignment([chats[2]!.id], node, organization, chats, "after").orderedThreadIds,
  ).toEqual(["first", "second", "moving"]);
  expect(() => threadDropAssignment([chats[1]!.id], node, organization, chats, "before")).toThrow();
  const ordered = {
    ...organization,
    memberships: move.orderedThreadIds.map((threadId, position) => ({
      threadId,
      folderId: move.folderId,
      position,
    })),
  };
  expect(
    flattenExplorer([{ id: env, organization: ordered, writable: true }], chats, {})
      .filter((row) => row.kind === "thread")
      .map((row) => row.thread.id),
  ).toEqual(move.orderedThreadIds);
});

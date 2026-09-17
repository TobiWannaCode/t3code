import { describe, expect, it } from "vite-plus/test";
import {
  ChatFolderId,
  CommandId,
  ThreadId,
  type ChatOrganization,
  type ChatOrganizationCommand,
} from "@t3tools/contracts";
import {
  CHAT_ORGANIZATION_ID,
  EMPTY_CHAT_ORGANIZATION,
  applyOrganizationChange,
  decideOrganizationChange,
} from "./chatOrganization.ts";
const now = "2026-09-16T00:00:00Z";
const id = ChatFolderId.make;
const t = ThreadId.make("chat");
const base = (revision: number) => ({
  commandId: CommandId.make(`command-${revision}`),
  organizationId: CHAT_ORGANIZATION_ID,
  expectedRevision: revision,
});
function apply(state: ChatOrganization, command: ChatOrganizationCommand) {
  return applyOrganizationChange(
    state,
    decideOrganizationChange(state, command, now, new Set([t])),
  );
}
function create(state: ChatOrganization, name: string, parentId: ChatFolderId | null = null) {
  return apply(state, {
    ...base(state.revision),
    type: "chatFolder.create",
    folderId: id(name),
    name,
    parentId,
  });
}
describe("chat organization", () => {
  it("promotes direct children into the removed slot and preserves deeper subtrees and memberships", () => {
    let state = create(EMPTY_CHAT_ORGANIZATION, "before");
    state = create(state, "parent");
    state = create(state, "after");
    state = create(state, "one", id("parent"));
    state = create(state, "two", id("parent"));
    state = create(state, "deep", id("one"));
    state = apply(state, {
      ...base(state.revision),
      type: "chatOrganization.assignThreads",
      threadIds: [t],
      folderId: id("parent"),
    });
    state = apply(state, {
      ...base(state.revision),
      type: "chatFolder.remove",
      folderId: id("parent"),
    });
    expect(
      state.folders
        .filter((f) => f.parentId === null)
        .sort((a, b) => a.position - b.position)
        .map((f) => f.name),
    ).toEqual(["before", "one", "two", "after"]);
    expect(state.folders.find((f) => f.id === id("deep"))?.parentId).toBe(id("one"));
    expect(state.memberships).toEqual([]);
  });
  it("rejects cycles, stale revisions and a subtree moved past the depth limit without mutating state", () => {
    let state = EMPTY_CHAT_ORGANIZATION;
    for (let i = 0; i < 16; i++) state = create(state, `n${i}`, i ? id(`n${i - 1}`) : null);
    const snapshot = JSON.stringify(state);
    expect(() =>
      apply(state, {
        ...base(state.revision),
        type: "chatFolder.move",
        folderId: id("n0"),
        parentId: id("n15"),
      }),
    ).toThrow();
    expect(() => create(state, "too-deep", id("n15"))).toThrow(/16 levels/);
    expect(() =>
      apply(state, { ...base(0), type: "chatFolder.rename", folderId: id("n0"), name: "new" }),
    ).toThrow(/folders changed/);
    expect(JSON.stringify(state)).toBe(snapshot);
  });
  it("rejects the entire assignment when any chat is gone and preserves previous membership", () => {
    let state = create(EMPTY_CHAT_ORGANIZATION, "group");
    state = apply(state, {
      ...base(state.revision),
      type: "chatOrganization.assignThreads",
      threadIds: [t],
      folderId: id("group"),
    });
    expect(() =>
      apply(state, {
        ...base(state.revision),
        type: "chatOrganization.assignThreads",
        threadIds: [t, ThreadId.make("gone")],
        folderId: null,
      }),
    ).toThrow(/no longer exists/);
    expect(state.memberships).toEqual([{ threadId: t, folderId: id("group") }]);
  });
  it("replays canonical changes idempotently and retains Unicode names", () => {
    const command = {
      ...base(0),
      type: "chatFolder.create" as const,
      folderId: id("unicode"),
      parentId: null,
      name: "  Déploiement 🚀  ",
    };
    const delta = decideOrganizationChange(EMPTY_CHAT_ORGANIZATION, command, now, new Set());
    const state = applyOrganizationChange(EMPTY_CHAT_ORGANIZATION, delta);
    expect(state.folders[0]?.name).toBe("Déploiement 🚀");
    expect(applyOrganizationChange(state, delta)).toBe(state);
  });
  it("allows duplicate labels and literal slashes, but validates names by code points", () => {
    let state = create(EMPTY_CHAT_ORGANIZATION, "one");
    state = create(state, "two");
    state = apply(state, {
      ...base(state.revision),
      type: "chatFolder.rename",
      folderId: id("one"),
      name: "A/B",
    });
    state = apply(state, {
      ...base(state.revision),
      type: "chatFolder.rename",
      folderId: id("two"),
      name: "A/B",
    });
    expect(state.folders.map((f) => f.name)).toEqual(["A/B", "A/B"]);
    expect(() =>
      apply(state, {
        ...base(state.revision),
        type: "chatFolder.rename",
        folderId: id("one"),
        name: "🚀".repeat(121),
      }),
    ).toThrow(/120/);
  });
});

it("persists atomic slot moves, keeps hidden membership, and rejects foreign destination chats", () => {
  let state = create(EMPTY_CHAT_ORGANIZATION, "group");
  state = create(state, "other");
  const ids = ["first", "moving", "hidden", "foreign"].map((value) => ThreadId.make(value));
  const [first, moving, hidden, foreign] = ids as [ThreadId, ThreadId, ThreadId, ThreadId];
  state = {
    ...state,
    memberships: [
      { threadId: first, folderId: id("group") },
      { threadId: hidden, folderId: id("group") },
      { threadId: foreign, folderId: id("other") },
    ],
  };
  const command = {
    ...base(state.revision),
    type: "chatOrganization.assignThreads" as const,
    threadIds: [moving],
    folderId: id("group"),
    orderedThreadIds: [moving, first],
  };
  const change = decideOrganizationChange(state, command, now, new Set(ids));
  expect(change.memberships).toEqual([
    { threadId: moving, folderId: id("group"), position: 0 },
    { threadId: first, folderId: id("group"), position: 1 },
    { threadId: hidden, folderId: id("group"), position: 2 },
  ]);
  expect(() =>
    decideOrganizationChange(
      state,
      { ...command, orderedThreadIds: [moving, foreign] },
      now,
      new Set(ids),
    ),
  ).toThrow(/destination chats changed/);
  expect(() =>
    decideOrganizationChange(state, { ...command, orderedThreadIds: [first] }, now, new Set(ids)),
  ).toThrow();
  expect(() =>
    decideOrganizationChange(
      state,
      { ...command, orderedThreadIds: [moving, first, first] },
      now,
      new Set(ids),
    ),
  ).toThrow();
  const next = applyOrganizationChange(state, change);
  const unfiled = decideOrganizationChange(
    next,
    { ...command, expectedRevision: next.revision, folderId: null, orderedThreadIds: [moving] },
    now,
    new Set(ids),
  );
  expect(unfiled.memberships).toEqual([{ threadId: moving, folderId: null, position: 0 }]);
});

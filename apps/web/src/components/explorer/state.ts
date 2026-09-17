import { useAtomValue } from "@effect/atom-react";
import type { ChatFolderId, EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { enabledEnvironmentIds } from "@t3tools/client-runtime/state/connections";
import { Atom } from "effect/unstable/reactivity";
import * as Option from "effect/Option";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { EMPTY_CHAT_ORGANIZATION, folderAncestors } from "@t3tools/shared/chatOrganization";
import { environmentCatalog } from "../../connection/catalog";
import { environmentShell } from "../../state/shell";
import { environmentServerConfigsAtom } from "../../state/server";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { folderKey, type ExplorerEnvironment } from "./model";

let previous: readonly ExplorerEnvironment[] = [];
export const explorerEnvironmentsAtom = Atom.make((get) => {
  const configs = get(environmentServerConfigsAtom);
  const next = Array.from(enabledEnvironmentIds(get(environmentCatalog.catalogValueAtom))).map(
    (id) => {
      const state = get(environmentShell.stateValueAtom(id));
      const supported = configs.get(id)?.environment.capabilities.chatOrganization === true;
      const organization = supported
        ? (Option.getOrNull(state.snapshot)?.chatOrganization ?? EMPTY_CHAT_ORGANIZATION)
        : EMPTY_CHAT_ORGANIZATION;
      const writable =
        supported &&
        state.status === "live" &&
        Option.getOrNull(state.snapshot)?.chatOrganization !== undefined;
      return (
        previous.find(
          (entry) =>
            entry.id === id && entry.organization === organization && entry.writable === writable,
        ) ?? { id, organization, writable }
      );
    },
  );
  if (next.length === previous.length && next.every((entry, index) => entry === previous[index]))
    return previous;
  previous = next;
  return next;
});
export const useExplorerEnvironments = () => useAtomValue(explorerEnvironmentsAtom);
export function supportsChatFolders(id: EnvironmentId) {
  return (
    appAtomRegistry.get(environmentServerConfigsAtom).get(id)?.environment.capabilities
      .chatOrganization === true
  );
}
export type ExplorerView = "chats" | "activity" | "settled";
export const useExplorerUi = create(
  persist<{
    view: ExplorerView;
    collapsed: Record<string, boolean>;
    settledFilter: { environmentId: EnvironmentId; folderId: ChatFolderId } | null;
    revealKey: string | null;
    revealVersion: number;
    revealFolderFor: string | null;
    scrollOffset: number;
    focusKey: string | null;
  }>(
    () => ({
      view: "chats",
      collapsed: {},
      settledFilter: null,
      revealKey: null,
      revealVersion: 0,
      revealFolderFor: null,
      scrollOffset: 0,
      focusKey: null,
    }),
    {
      name: "t3code:chat-explorer:v1",
      partialize: (state) => ({
        ...state,
        settledFilter: null,
        revealKey: null,
        revealVersion: 0,
        revealFolderFor: null,
      }),
    },
  ),
);
export function toggleExplorerNode(key: string, collapsed?: boolean) {
  useExplorerUi.setState((state) => ({
    collapsed: { ...state.collapsed, [key]: collapsed ?? !state.collapsed[key] },
  }));
}
export function revealChatFolder(ref: ScopedThreadRef, folderOnly = false) {
  const env = appAtomRegistry
    .get(explorerEnvironmentsAtom)
    .find((entry) => entry.id === ref.environmentId);
  const folderId = env?.organization.memberships.find(
    (member) => member.threadId === ref.threadId,
  )?.folderId;
  useExplorerUi.setState((state) => {
    const collapsed = { ...state.collapsed, [`${ref.environmentId}:root`]: false };
    if (folderId && env)
      for (const folder of folderAncestors(env.organization, folderId))
        collapsed[folderKey(ref.environmentId, folder.id)] = false;
    else collapsed[folderKey(ref.environmentId, null)] = false;
    return {
      view: "chats",
      collapsed,
      revealKey: folderOnly
        ? folderKey(ref.environmentId, folderId ?? null)
        : `${ref.environmentId}:${ref.threadId}`,
      revealVersion: state.revealVersion + 1,
      revealFolderFor: folderOnly ? `${ref.environmentId}:${ref.threadId}` : null,
    };
  });
}
export type FolderRequest = { environmentId: EnvironmentId } & (
  | { kind: "create"; parentId: ChatFolderId | null }
  | { kind: "rename" | "remove" | "move-folder" | "new-chat"; folderId: ChatFolderId }
  | { kind: "move-threads"; threadRefs: readonly ScopedThreadRef[]; targetId?: ChatFolderId | null }
);
export const useFolderRequest = create<{ request: FolderRequest | null }>(() => ({
  request: null,
}));
export const openFolderDialog = (request: FolderRequest) => useFolderRequest.setState({ request });
export const openMoveChats = (threadRefs: readonly ScopedThreadRef[]) => {
  const first = threadRefs[0];
  if (first)
    openFolderDialog({ kind: "move-threads", environmentId: first.environmentId, threadRefs });
};

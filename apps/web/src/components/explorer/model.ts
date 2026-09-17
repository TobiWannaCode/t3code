import type { ChatFolder, ChatFolderId, ChatOrganization, EnvironmentId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EMPTY_CHAT_ORGANIZATION, MAX_CHAT_FOLDER_DEPTH } from "@t3tools/shared/chatOrganization";

export interface ExplorerEnvironment {
  id: EnvironmentId;
  organization: ChatOrganization;
  writable: boolean;
}
export type ExplorerNode = {
  key: string;
  environmentId: EnvironmentId;
  level: number;
  position: number;
  size: number;
  parentKey: string | null;
} & (
  | { kind: "environment" }
  | { kind: "folder"; folder: ChatFolder }
  | { kind: "unfiled" }
  | { kind: "thread"; thread: EnvironmentThreadShell }
);
export const folderKey = (environmentId: EnvironmentId, folderId: ChatFolderId | null) =>
  `${environmentId}:folder:${folderId ?? "unfiled"}`;
export const threadKey = (thread: EnvironmentThreadShell) =>
  scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));

export type ExplorerParkedState = "settled" | "snoozed";
export type ExplorerFolderVisibility = Readonly<
  Record<string, Partial<Record<ExplorerParkedState, boolean>>>
>;

export function flattenExplorer(
  environments: readonly ExplorerEnvironment[],
  threads: readonly EnvironmentThreadShell[],
  collapsed: Readonly<Record<string, boolean>>,
  parked: ReadonlyMap<string, ExplorerParkedState> = new Map(),
  visibility: ExplorerFolderVisibility = {},
): ExplorerNode[] {
  const result: ExplorerNode[] = [];
  const threadsByEnvironment = new Map<EnvironmentId, EnvironmentThreadShell[]>();
  for (const thread of threads) {
    const entries = threadsByEnvironment.get(thread.environmentId) ?? [];
    entries.push(thread);
    threadsByEnvironment.set(thread.environmentId, entries);
  }
  for (const [index, env] of environments.entries()) {
    const rootKey = `${env.id}:root`;
    result.push({
      kind: "environment",
      key: rootKey,
      environmentId: env.id,
      level: 1,
      position: index + 1,
      size: environments.length,
      parentKey: null,
    });
    if (collapsed[rootKey]) continue;
    const organization = env.organization ?? EMPTY_CHAT_ORGANIZATION;
    // A malformed cached forest must never hide chats. Keep its members in Unfiled
    // until an authoritative snapshot repairs missing parents, cycles, or excessive depth.
    const folderIndex = new Map(organization.folders.map((folder) => [folder.id, folder]));
    const folderIds = new Set(
      organization.folders
        .filter((folder) => {
          const ancestors = new Set<ChatFolderId>();
          let current: ChatFolder | undefined = folder;
          while (current) {
            if (ancestors.has(current.id) || ancestors.size >= MAX_CHAT_FOLDER_DEPTH) return false;
            ancestors.add(current.id);
            if (current.parentId === null) return true;
            current = folderIndex.get(current.parentId);
          }
          return false;
        })
        .map((folder) => folder.id),
    );
    const foldersByParent = new Map<ChatFolderId | null, ChatFolder[]>();
    for (const folder of organization.folders) {
      if (!folderIds.has(folder.id)) continue;
      const parent =
        folder.parentId !== null && folderIds.has(folder.parentId) ? folder.parentId : null;
      const entries = foldersByParent.get(parent) ?? [];
      entries.push(folder);
      foldersByParent.set(parent, entries);
    }
    for (const entries of foldersByParent.values())
      entries.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    const memberships = new Map(
      organization.memberships.map((member) => [member.threadId, member.folderId]),
    );
    const byFolder = new Map<ChatFolderId | null, EnvironmentThreadShell[]>();
    for (const thread of orderExplorerThreads(
      organization,
      threadsByEnvironment.get(env.id) ?? [],
    )) {
      const assigned = memberships.get(thread.id);
      const folderId = assigned && folderIds.has(assigned) ? assigned : null;
      const lifecycle = parked.get(threadKey(thread));
      if (lifecycle && !visibility[folderKey(env.id, folderId)]?.[lifecycle]) continue;
      const entries = byFolder.get(folderId) ?? [];
      entries.push(thread);
      byFolder.set(folderId, entries);
    }
    const seen = new Set<ChatFolderId>();
    const visit = (parentId: ChatFolderId | null, level: number, parentKey: string) => {
      const folders = foldersByParent.get(parentId) ?? [];
      const children = parentId === null ? [] : (byFolder.get(parentId) ?? []);
      const size = folders.length + children.length + (parentId === null ? 1 : 0);
      for (const [position, folder] of folders.entries()) {
        if (seen.has(folder.id)) continue;
        seen.add(folder.id);
        const key = folderKey(env.id, folder.id);
        result.push({
          kind: "folder",
          key,
          folder,
          environmentId: env.id,
          level,
          position: position + 1,
          size,
          parentKey,
        });
        if (!collapsed[key] && level <= 17) visit(folder.id, level + 1, key);
      }
      children.forEach((thread, index) =>
        result.push({
          kind: "thread",
          key: threadKey(thread),
          thread,
          environmentId: env.id,
          level,
          position: folders.length + index + 1,
          size,
          parentKey,
        }),
      );
      if (parentId === null) {
        const key = folderKey(env.id, null);
        const unfiled = byFolder.get(null) ?? [];
        result.push({
          kind: "unfiled",
          key,
          environmentId: env.id,
          level,
          position: size,
          size,
          parentKey,
        });
        if (!collapsed[key])
          unfiled.forEach((thread, index) =>
            result.push({
              kind: "thread",
              key: threadKey(thread),
              thread,
              environmentId: env.id,
              level: level + 1,
              position: index + 1,
              size: unfiled.length,
              parentKey: key,
            }),
          );
      }
    };
    visit(null, 2, rootKey);
  }
  return result;
}

export function orderExplorerThreads(
  organization: ChatOrganization,
  threads: readonly EnvironmentThreadShell[],
) {
  const positions = new Map(
    organization.memberships
      .filter((member) => member.position !== undefined)
      .map((member) => [member.threadId, member.position!]),
  );
  return threads.toSorted(
    (a, b) => (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity),
  );
}

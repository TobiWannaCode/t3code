import {
  ChatOrganizationId,
  type ChatFolder,
  type ChatFolderId,
  type ChatOrganization,
  type ChatOrganizationChange,
  type ChatOrganizationCommand,
  type ThreadId,
} from "@t3tools/contracts";

export const CHAT_ORGANIZATION_ID = ChatOrganizationId.make("chat-organization");
export const EMPTY_CHAT_ORGANIZATION: ChatOrganization = {
  revision: 0,
  folders: [],
  memberships: [],
};
export const MAX_CHAT_FOLDER_DEPTH = 16;

export function folderAncestors(organization: ChatOrganization, id: ChatFolderId): ChatFolder[] {
  const byId = new Map(organization.folders.map((folder) => [folder.id, folder]));
  const ancestors: ChatFolder[] = [];
  const seen = new Set<ChatFolderId>();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    ancestors.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return ancestors;
}

export function applyOrganizationChange(
  current: ChatOrganization,
  change: ChatOrganizationChange,
): ChatOrganization {
  if (change.revision <= current.revision) return current;
  const folders = new Map(current.folders.map((folder) => [folder.id, folder]));
  const memberships = new Map(current.memberships.map((member) => [member.threadId, member]));
  for (const id of change.removedFolderIds) folders.delete(id);
  for (const folder of change.folders) folders.set(folder.id, folder);
  for (const id of change.unassignedThreadIds) memberships.delete(id);
  for (const member of change.memberships) memberships.set(member.threadId, member);
  return {
    revision: change.revision,
    folders: [...folders.values()],
    memberships: [...memberships.values()],
  };
}

export function organizationAssignment(
  current: ChatOrganization,
  threadIds: readonly ThreadId[],
  folderId: ChatFolderId | null,
  orderedThreadIds?: readonly ThreadId[],
): ChatOrganizationChange {
  if (folderId !== null && !current.folders.some((folder) => folder.id === folderId))
    throw new Error("The destination folder no longer exists. Choose another folder or Unfiled.");
  if (orderedThreadIds) {
    const moving = new Set(threadIds);
    const ordered = new Set(orderedThreadIds);
    const members = new Map(current.memberships.map((member) => [member.threadId, member]));
    if (
      ordered.size !== orderedThreadIds.length ||
      threadIds.some((id) => !ordered.has(id)) ||
      orderedThreadIds.some(
        (id) => !moving.has(id) && (members.get(id)?.folderId ?? null) !== folderId,
      )
    )
      throw new Error("The destination chats changed. Try the move again.");
    return {
      revision: current.revision + 1,
      folders: [],
      removedFolderIds: [],
      unassignedThreadIds: [],
      memberships: [
        ...orderedThreadIds,
        ...current.memberships
          .filter(
            (member) =>
              member.folderId === folderId &&
              !ordered.has(member.threadId) &&
              !moving.has(member.threadId),
          )
          .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity))
          .map((member) => member.threadId),
      ].map((threadId, position) => ({ threadId, folderId, position })),
    };
  }
  return {
    revision: current.revision + 1,
    folders: [],
    removedFolderIds: [],
    memberships: folderId === null ? [] : threadIds.map((threadId) => ({ threadId, folderId })),
    unassignedThreadIds: folderId === null ? [...threadIds] : [],
  };
}

export function decideOrganizationChange(
  current: ChatOrganization,
  command: ChatOrganizationCommand,
  now: string,
  liveThreadIds: ReadonlySet<ThreadId>,
): ChatOrganizationChange {
  if (command.organizationId !== CHAT_ORGANIZATION_ID)
    throw new Error("Unknown chat organization.");
  if (command.expectedRevision !== current.revision)
    throw new Error(
      `The folders changed. Try this action again. Current revision: ${current.revision}.`,
    );
  if (command.type === "chatOrganization.assignThreads") {
    if (
      command.threadIds.length < 1 ||
      command.threadIds.length > 500 ||
      new Set(command.threadIds).size !== command.threadIds.length
    )
      throw new Error("Choose between 1 and 500 distinct chats.");
    if (command.threadIds.some((id) => !liveThreadIds.has(id)))
      throw new Error("A selected chat no longer exists in this environment.");
    if (command.orderedThreadIds?.some((id) => !liveThreadIds.has(id)))
      throw new Error("A destination chat no longer exists in this environment.");
    return organizationAssignment(
      current,
      command.threadIds,
      command.folderId,
      command.orderedThreadIds,
    );
  }
  const folders = new Map(current.folders.map((folder) => [folder.id, folder]));
  const changed = new Map<ChatFolderId, ChatFolder>();
  const removedFolderIds: ChatFolderId[] = [];
  let memberships: ChatOrganizationChange["memberships"] = [];
  let unassignedThreadIds: ChatOrganizationChange["unassignedThreadIds"] = [];
  const set = (folder: ChatFolder) => {
    folders.set(folder.id, folder);
    changed.set(folder.id, folder);
  };
  const siblings = (parentId: ChatFolderId | null) =>
    [...folders.values()]
      .filter((folder) => folder.parentId === parentId)
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const rank = (entries: readonly ChatFolder[]) =>
    entries.forEach((folder, position) => {
      if (folder.position !== position) set({ ...folder, position, updatedAt: now });
    });
  const insert = (folder: ChatFolder, beforeId?: ChatFolderId) => {
    const entries = siblings(folder.parentId).filter((entry) => entry.id !== folder.id);
    const index =
      beforeId === undefined ? entries.length : entries.findIndex((entry) => entry.id === beforeId);
    if (index < 0) throw new Error("The destination changed. Choose a current sibling.");
    entries.splice(index, 0, folder);
    set(folder);
    rank(entries);
  };
  if (
    "name" in command &&
    (command.name.trim().length === 0 ||
      [...command.name.trim()].length > 120 ||
      /[\u0000-\u001f\u007f-\u009f]/.test(command.name))
  )
    throw new Error("Folder names must contain 1–120 characters and no control characters.");
  const previous = folders.get(command.folderId);
  if (command.type === "chatFolder.create") {
    if (previous) throw new Error("This folder already exists.");
    insert(
      {
        id: command.folderId,
        parentId: command.parentId,
        name: command.name.trim(),
        position: 0,
        createdAt: now,
        updatedAt: now,
      },
      command.beforeId,
    );
  } else {
    if (!previous) throw new Error("The folder no longer exists.");
    if (command.type === "chatFolder.rename")
      set({ ...previous, name: command.name.trim(), updatedAt: now });
    else if (command.type === "chatFolder.move") {
      insert({ ...previous, parentId: command.parentId, updatedAt: now }, command.beforeId);
      if (previous.parentId !== command.parentId) rank(siblings(previous.parentId));
    } else {
      const entries = siblings(previous.parentId);
      const children = siblings(previous.id).map((child) => ({
        ...child,
        parentId: previous.parentId,
        updatedAt: now,
      }));
      entries.splice(
        entries.findIndex((entry) => entry.id === previous.id),
        1,
        ...children,
      );
      folders.delete(previous.id);
      removedFolderIds.push(previous.id);
      children.forEach(set);
      rank(entries);
      const assigned = current.memberships.filter((member) => member.folderId === previous.id);
      if (previous.parentId === null)
        unassignedThreadIds = assigned.map((member) => member.threadId);
      else
        memberships = assigned.map((member) => ({
          threadId: member.threadId,
          folderId: previous.parentId!,
        }));
    }
  }
  // Validate the whole resulting forest, including descendants of a moved subtree.
  for (const folder of folders.values()) {
    const seen = new Set<ChatFolderId>();
    let node: ChatFolder | undefined = folder;
    while (node) {
      if (seen.has(node.id))
        throw new Error("A folder cannot be moved inside itself or its descendants.");
      seen.add(node.id);
      if (seen.size > MAX_CHAT_FOLDER_DEPTH)
        throw new Error("Folders can be nested up to 16 levels.");
      if (node.parentId === null) break;
      node = folders.get(node.parentId);
      if (!node) throw new Error("The parent folder no longer exists.");
    }
  }
  return {
    revision: current.revision + 1,
    folders: [...changed.values()],
    removedFolderIds,
    memberships,
    unassignedThreadIds,
  };
}

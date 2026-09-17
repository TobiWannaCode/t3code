import { Schema } from "effect";
import { Tooltip, TooltipTrigger, TooltipPopup, TooltipProvider } from "../ui/tooltip";
import { MessageSquareIcon, ListTodoIcon, ArchiveIcon } from "lucide-react";
import { createPortal } from "react-dom";
import { EXPLORER_DRAG_TYPE, decodeExplorerDrag, threadDropAssignment } from "./drag";
import { useUiStateStore } from "../../uiStateStore";
import {
  resolveThreadStatusPill,
  resolveProjectStatusIndicator,
  type ThreadStatusPill,
} from "../Sidebar.logic";
import { useEffect, useMemo, useRef, useState, type ReactNode, type KeyboardEvent } from "react";
import { LegendList, type LegendListRef } from "@legendapp/list/react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { scopeThreadRef, parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  ChatFolderId,
  CommandId,
  type EnvironmentId,
  type ChatOrganizationCommand,
  OrchestrationDispatchCommandError,
} from "@t3tools/contracts";
import { CHAT_ORGANIZATION_ID, decideOrganizationChange } from "@t3tools/shared/chatOrganization";
import {
  FolderIcon,
  FolderOpenIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  MoreHorizontalIcon,
  PlusIcon,
} from "lucide-react";
import { useThreadSelectionStore } from "../../threadSelectionStore";
import { useAtomCommand } from "../../state/use-atom-command";
import { orchestrationEnvironment } from "../../state/orchestration";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { randomUUID } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import { flattenExplorer, folderKey, threadKey, type ExplorerNode } from "./model";
import {
  openFolderDialog,
  openMoveChats,
  revealChatFolder,
  toggleExplorerNode,
  useExplorerEnvironments,
  useExplorerUi,
} from "./state";

const isDispatchRejection = Schema.is(OrchestrationDispatchCommandError);

const DRAG_TYPE = EXPLORER_DRAG_TYPE;
export function useExplorerModel(
  enabled: boolean,
  threads: readonly EnvironmentThreadShell[],
  routeKey: string | null,
  settled: ReadonlySet<string>,
  snoozed: ReadonlySet<string>,
) {
  const environments = useExplorerEnvironments();
  const collapsed = useExplorerUi((state) => state.collapsed);
  const view = useExplorerUi((state) => state.view);
  const lastRoute = useRef("");
  const routeRef = routeKey ? parseScopedThreadKey(routeKey) : null;
  const routeFolder = environments
    .find((entry) => entry.id === routeRef?.environmentId)
    ?.organization.memberships.find((entry) => entry.threadId === routeRef?.threadId)?.folderId;
  const routeVisible = threads.some((thread) => threadKey(thread) === routeKey);
  const lifecycle =
    routeKey && settled.has(routeKey)
      ? "settled"
      : routeKey && snoozed.has(routeKey)
        ? "activity"
        : "chats";
  useEffect(() => {
    if (!enabled || !routeKey) return;
    const key = `${routeKey}:${lifecycle}:${routeFolder ?? "unfiled"}`;
    if (useExplorerUi.getState().revealFolderFor === routeKey) {
      lastRoute.current = key;
      return;
    }
    if (useExplorerUi.getState().revealFolderFor) useExplorerUi.setState({ revealFolderFor: null });
    if (lifecycle === "chats" && !routeVisible) return;
    if (lastRoute.current === key) return;
    lastRoute.current = key;
    const ref = parseScopedThreadKey(routeKey);
    if (ref && lifecycle === "chats") revealChatFolder(ref);
    else useExplorerUi.setState({ view: lifecycle, settledFilter: null });
  }, [enabled, routeKey, lifecycle, routeFolder, routeVisible]);
  const nodes = useMemo(
    () => (enabled ? flattenExplorer(environments, threads, collapsed) : []),
    [enabled, environments, threads, collapsed],
  );
  return { environments, collapsed, view, nodes, liveThreads: threads };
}
export function ExplorerNavigation() {
  const view = useExplorerUi((state) => state.view);
  const entries = [
    { value: "chats", label: "Chats", icon: MessageSquareIcon },
    { value: "activity", label: "Activity", icon: ListTodoIcon },
    { value: "settled", label: "Settled", icon: ArchiveIcon },
  ] as const;
  return (
    <TooltipProvider delay={150}>
      <nav
        aria-label="Conversation views"
        className="flex gap-1 border-b border-sidebar-border px-2 py-1 md:absolute md:inset-y-0 md:left-0 md:z-10 md:w-11 md:flex-col md:border-r md:border-b-0 md:px-1 md:py-2"
      >
        {entries.map(({ value, label, icon: Icon }) => (
          <Tooltip key={value}>
            <TooltipTrigger
              type="button"
              aria-label={label}
              aria-current={view === value ? "page" : undefined}
              className={`flex flex-1 items-center justify-center gap-1 rounded px-2 py-2 text-xs md:flex-none ${view === value ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent"}`}
              onClick={() => useExplorerUi.setState({ view: value, settledFilter: null })}
            >
              <Icon className="size-4" />
              <span className="md:sr-only">{label}</span>
            </TooltipTrigger>
            <TooltipPopup side="right">{label}</TooltipPopup>
          </Tooltip>
        ))}
      </nav>
    </TooltipProvider>
  );
}
export function SettledFolderFilter() {
  const filter = useExplorerUi((state) => state.settledFilter);
  const environments = useExplorerEnvironments();
  const env = environments.find((entry) => entry.id === filter?.environmentId);
  const folder = env?.organization.folders.find((entry) => entry.id === filter?.folderId);
  useEffect(() => {
    if (filter && env?.writable && !folder) useExplorerUi.setState({ settledFilter: null });
  }, [filter, env, folder]);
  return filter ? (
    <button
      type="button"
      className="mx-2 my-1 rounded bg-sidebar-accent px-2 py-1 text-xs"
      onClick={() => useExplorerUi.setState({ settledFilter: null })}
    >
      Settled in {folder?.name ?? "folder"} · Clear filter
    </button>
  ) : null;
}
export function ExplorerTree({
  model,
  renderThread,
  environmentLabels,
  hiddenThreads,
}: {
  model: ReturnType<typeof useExplorerModel>;
  renderThread: (thread: EnvironmentThreadShell) => ReactNode;
  environmentLabels: ReadonlyMap<EnvironmentId, string>;
  hiddenThreads: readonly EnvironmentThreadShell[];
}) {
  const { nodes, environments, collapsed } = model;
  const list = useRef<LegendListRef | null>(null);
  const tree = useRef<HTMLDivElement | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(() => useExplorerUi.getState().focusKey);
  const [initialOffset] = useState(() => useExplorerUi.getState().scrollOffset);
  const [visibleKeys, setVisibleKeys] = useState<ReadonlySet<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<{
    key: string;
    position: "before" | "after" | "inside";
    label: string;
    x: number;
    y: number;
  } | null>(null);
  const draggedKind = useRef<"folder" | "threads" | null>(null);
  const [retryMove, setRetryMove] = useState<{
    environmentId: EnvironmentId;
    input: ChatOrganizationCommand;
  } | null>(null);
  const [previousNodes, setPreviousNodes] = useState(nodes);
  const scrollOffset = useRef(initialOffset);
  useEffect(
    () => () => {
      useExplorerUi.setState({ scrollOffset: scrollOffset.current });
    },
    [],
  );
  useEffect(() => {
    useExplorerUi.setState({ focusKey });
  }, [focusKey]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const dispatch = useAtomCommand(orchestrationEnvironment.dispatchCommand, {
    reportFailure: false,
  });
  const lastVisited = useUiStateStore((state) => state.threadLastVisitedAtById);
  const summaries = useMemo(() => {
    const counts = new Map<
      string,
      { settled: number; snoozed: number; status: ThreadStatusPill | null }
    >();
    const indexes = new Map(
      environments.map((env) => [
        env.id,
        {
          members: new Map(
            env.organization.memberships.map((member) => [member.threadId, member.folderId]),
          ),
          folders: new Map(env.organization.folders.map((folder) => [folder.id, folder])),
        },
      ]),
    );
    const visit = (thread: EnvironmentThreadShell, hidden: boolean) => {
      const index = indexes.get(thread.environmentId);
      if (!index) return;
      let id = index.members.get(thread.id);
      const seen = new Set<ChatFolderId>();
      const status = hidden
        ? null
        : resolveThreadStatusPill({
            thread: { ...thread, lastVisitedAt: lastVisited[threadKey(thread)] },
          });
      while (id && !seen.has(id)) {
        seen.add(id);
        const key = folderKey(thread.environmentId, id);
        const entry = counts.get(key) ?? { settled: 0, snoozed: 0, status: null };
        if (hidden) {
          if (thread.snoozedUntil && Date.parse(thread.snoozedUntil) > Date.now()) entry.snoozed++;
          else entry.settled++;
        } else entry.status = resolveProjectStatusIndicator([entry.status, status]);
        counts.set(key, entry);
        id = index.folders.get(id)?.parentId ?? undefined;
      }
    };
    model.liveThreads.forEach((thread) => visit(thread, false));
    hiddenThreads.forEach((thread) => visit(thread, true));
    return counts;
  }, [environments, model.liveThreads, hiddenThreads, lastVisited]);
  const revealKey = useExplorerUi((state) => state.revealKey);
  const revealVersion = useExplorerUi((state) => state.revealVersion);
  const previousReveal = useRef(-1);
  useEffect(() => {
    if (!revealKey || previousReveal.current === revealVersion) return;
    const index = nodes.findIndex((node) => node.key === revealKey);
    if (index < 0) return;
    previousReveal.current = revealVersion;
    setFocusKey(revealKey);
    void list.current?.scrollToIndex({ index, animated: false });
  }, [nodes, revealKey, revealVersion]);
  const previousNode = previousNodes.find((node) => node.key === focusKey);
  const activeKey = nodes.some((node) => node.key === focusKey)
    ? focusKey
    : (nodes.find((node) => node.key === previousNode?.parentKey)?.key ??
      nodes[
        Math.min(
          Math.max(
            0,
            previousNodes.findIndex((node) => node.key === focusKey),
          ),
          nodes.length - 1,
        )
      ]?.key);
  if (previousNodes !== nodes) {
    setPreviousNodes(nodes);
    if (activeKey && activeKey !== focusKey) setFocusKey(activeKey);
  }
  const performMove = async (input: {
    environmentId: EnvironmentId;
    input: ChatOrganizationCommand;
  }) => {
    setPending(true);
    setError(null);
    setRetryMove(input);
    try {
      const result = await dispatch(input);
      if (result._tag === "Failure") {
        const cause = squashAtomCommandFailure(result);
        if (isDispatchRejection(cause)) setRetryMove(null);
        throw cause;
      }
      setRetryMove(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not move. Retry when connected.");
    } finally {
      setPending(false);
    }
  };
  const focus = (index: number) => {
    const node = nodes[Math.max(0, Math.min(index, nodes.length - 1))];
    if (!node) return;
    setFocusKey(node.key);
    list.current?.scrollToIndex({ index, animated: false });
    tree.current?.focus();
  };
  const menu = async (node: ExplorerNode, x: number, y: number) => {
    const env = environments.find((entry) => entry.id === node.environmentId);
    if (!env?.writable) return;
    const selected = await readLocalApi()?.contextMenu.show(
      [
        { id: "create", label: node.kind === "folder" ? "Create subfolder…" : "Create folder…" },
        ...(node.kind === "folder"
          ? [
              { id: "new-chat", label: "New chat in folder…" },
              { id: "rename", label: "Rename folder…" },
              { id: "move-folder", label: "Move or reorder folder…" },
              { id: "settled", label: "View settled here" },
              { id: "remove", label: "Remove folder…", destructive: true },
            ]
          : []),
      ],
      { x, y },
    );
    if (!selected) return;
    if (selected === "create")
      openFolderDialog({
        kind: "create",
        environmentId: node.environmentId,
        parentId: node.kind === "folder" ? node.folder.id : null,
      });
    else if (node.kind === "folder") {
      if (selected === "settled")
        useExplorerUi.setState({
          view: "settled",
          settledFilter: { environmentId: node.environmentId, folderId: node.folder.id },
        });
      else if (
        selected === "new-chat" ||
        selected === "rename" ||
        selected === "move-folder" ||
        selected === "remove"
      )
        openFolderDialog({
          kind: selected,
          environmentId: node.environmentId,
          folderId: node.folder.id,
        });
    }
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.target instanceof HTMLElement &&
      event.target.closest("input,textarea,select,[contenteditable=true]")
    )
      return;
    if (event.key === "Enter" && event.target !== tree.current) return;
    const index = Math.max(
      0,
      nodes.findIndex((node) => node.key === activeKey),
    );
    const node = nodes[index];
    if (!node) return;
    const prevent = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (event.key === "ArrowDown") {
      prevent();
      focus(index + 1);
    } else if (event.key === "ArrowUp") {
      prevent();
      focus(index - 1);
    } else if (event.key === "Home") {
      prevent();
      focus(0);
    } else if (event.key === "End") {
      prevent();
      focus(nodes.length - 1);
    } else if (event.key === "ArrowRight") {
      prevent();
      if (node.kind !== "thread" && collapsed[node.key]) toggleExplorerNode(node.key, false);
      else if (nodes[index + 1]?.parentKey === node.key) focus(index + 1);
    } else if (event.key === "ArrowLeft") {
      prevent();
      if (node.kind !== "thread" && !collapsed[node.key]) toggleExplorerNode(node.key, true);
      else if (node.parentKey) focus(nodes.findIndex((entry) => entry.key === node.parentKey));
    } else if (event.key === "Enter") {
      prevent();
      if (node.kind !== "thread") toggleExplorerNode(node.key);
      else
        tree.current
          ?.querySelector<HTMLElement>(`[data-explorer-index="${index}"] [role="button"]`)
          ?.click();
    } else if (event.key === "F2" && node.kind === "folder") {
      prevent();
      openFolderDialog({
        kind: "rename",
        environmentId: node.environmentId,
        folderId: node.folder.id,
      });
    } else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      prevent();
      const rect = tree.current?.getBoundingClientRect();
      if (node.kind === "thread")
        openMoveChats([scopeThreadRef(node.environmentId, node.thread.id)]);
      else void menu(node, rect?.left ?? 0, rect?.top ?? 0);
    } else if (event.key === "Escape") {
      prevent();
      setError(null);
    }
  };
  // Legend List caches rows by item identity. Focus and drag feedback can change
  // without changing the tree data, so include those render dependencies explicitly.
  const rowState = useMemo(
    () => ({ activeKey, pending, dropTarget, summaries, environmentLabels }),
    [activeKey, pending, dropTarget, summaries, environmentLabels],
  );
  return (
    <li className="list-none">
      <div
        ref={tree}
        role="tree"
        aria-label="Chat folders"
        tabIndex={0}
        aria-activedescendant={
          activeKey && visibleKeys.has(activeKey)
            ? `explorer-${encodeURIComponent(activeKey)}`
            : undefined
        }
        className="h-[60vh] min-h-48 outline-none"
        onKeyDown={onKey}
      >
        <LegendList<ExplorerNode>
          style={{ height: "100%" }}
          ref={list}
          data={nodes}
          extraData={rowState}
          initialScrollOffset={initialOffset}
          maintainVisibleContentPosition
          onScroll={(event) => {
            scrollOffset.current = event.nativeEvent.contentOffset.y;
          }}
          onViewableItemsChanged={({ viewableItems }) =>
            setVisibleKeys((previous) => {
              const next = new Set(viewableItems.map((entry) => entry.key));
              return next.size === previous.size && [...next].every((key) => previous.has(key))
                ? previous
                : next;
            })
          }
          keyExtractor={(node) => node.key}
          estimatedItemSize={36}
          drawDistance={250}
          renderItem={({ item: node, index }) => {
            const env = environments.find((entry) => entry.id === node.environmentId);
            const expanded = node.kind !== "thread" && !collapsed[node.key];
            return (
              <div
                id={`explorer-${encodeURIComponent(node.key)}`}
                role="treeitem"
                aria-level={node.level}
                aria-posinset={node.position}
                aria-setsize={node.size}
                aria-expanded={node.kind === "thread" ? undefined : expanded}
                aria-selected={activeKey === node.key}
                data-explorer-index={index}
                className={`group relative rounded ${dropTarget?.key === node.key ? (dropTarget.position === "before" ? "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-20 before:border-t-2 before:border-primary" : dropTarget.position === "after" ? "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:z-20 after:border-b-2 after:border-primary" : "bg-sidebar-accent ring-1 ring-primary") : ""} ${activeKey === node.key ? "outline outline-1 outline-sidebar-border" : ""}`}
                style={{ paddingLeft: (node.level - 1) * 12 }}
                onFocus={() => setFocusKey(node.key)}
                draggable={
                  env?.writable && !pending && (node.kind === "folder" || node.kind === "thread")
                }
                onDragStart={(event) => {
                  if (node.kind !== "thread" && node.kind !== "folder") return;
                  const selected = useThreadSelectionStore.getState().selectedThreadKeys;
                  const refs =
                    node.kind === "thread"
                      ? selected.has(threadKey(node.thread))
                        ? [...selected].map(parseScopedThreadKey).filter((ref) => ref !== null)
                        : [scopeThreadRef(node.environmentId, node.thread.id)]
                      : [];
                  draggedKind.current = node.kind === "folder" ? "folder" : "threads";
                  event.dataTransfer.setData(
                    DRAG_TYPE,
                    JSON.stringify(
                      node.kind === "folder"
                        ? {
                            kind: "folder",
                            environmentId: node.environmentId,
                            folderId: node.folder.id,
                          }
                        : { kind: "threads", environmentId: node.environmentId, refs },
                    ),
                  );
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => {
                  setDropTarget(null);
                  draggedKind.current = null;
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                    setDropTarget(null);
                }}
                onDragOver={(event) => {
                  if (
                    env?.writable &&
                    !pending &&
                    (node.kind !== "thread" || draggedKind.current === "threads") &&
                    event.dataTransfer.types.includes(DRAG_TYPE)
                  ) {
                    const rect = event.currentTarget.getBoundingClientRect();
                    const offset = event.clientY - rect.top;
                    const position =
                      node.kind === "thread"
                        ? offset < rect.height / 2
                          ? "before"
                          : "after"
                        : draggedKind.current === "folder" && node.kind === "folder"
                          ? offset < 9
                            ? "before"
                            : offset > rect.height - 9
                              ? "after"
                              : "inside"
                          : "inside";
                    const folderId =
                      node.kind === "folder"
                        ? node.folder.id
                        : node.kind === "thread"
                          ? env.organization.memberships.find(
                              (member) => member.threadId === node.thread.id,
                            )?.folderId
                          : null;
                    const destination =
                      env.organization.folders.find((folder) => folder.id === folderId)?.name ??
                      "Unfiled";
                    setDropTarget({
                      key: node.key,
                      position,
                      label:
                        node.kind === "thread"
                          ? `Move ${position} chat in ${destination}`
                          : position === "inside"
                            ? `Move into ${destination}`
                            : `Move ${position} folder`,
                      x: Math.min(event.clientX + 14, window.innerWidth - 230),
                      y: Math.min(event.clientY + 18, window.innerHeight - 44),
                    });
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }
                }}
                onDrop={(event) => {
                  if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setDropTarget(null);
                  if (!env?.writable || pending) return;
                  void (async () => {
                    try {
                      const data = decodeExplorerDrag(event.dataTransfer.getData(DRAG_TYPE));
                      if (node.kind === "thread" && data.kind !== "threads")
                        throw new Error("Drop folders on a folder row.");
                      if (data.environmentId !== node.environmentId)
                        throw new Error("Folders cannot span environments.");
                      let parentId = node.kind === "folder" ? node.folder.id : null;
                      let beforeId: ChatFolderId | undefined;
                      if (data.kind === "folder" && node.kind === "folder") {
                        const rect = event.currentTarget.getBoundingClientRect();
                        const offset = event.clientY - rect.top;
                        if (offset < 9 || offset > rect.height - 9) {
                          parentId = node.folder.parentId;
                          const siblings = env.organization.folders
                            .filter(
                              (folder) =>
                                folder.parentId === parentId && folder.id !== data.folderId,
                            )
                            .sort((a, b) => a.position - b.position);
                          beforeId =
                            offset < 9
                              ? node.folder.id
                              : siblings[
                                  siblings.findIndex((folder) => folder.id === node.folder.id) + 1
                                ]?.id;
                        }
                      }
                      if (
                        data.kind === "threads" &&
                        data.refs.some((ref) => ref.environmentId !== node.environmentId)
                      )
                        throw new Error("Choose chats from one environment.");
                      const common = {
                        commandId: CommandId.make(randomUUID()),
                        organizationId: CHAT_ORGANIZATION_ID,
                        expectedRevision: env.organization.revision,
                      };
                      const command =
                        data.kind === "threads"
                          ? {
                              ...common,
                              type: "chatOrganization.assignThreads" as const,
                              threadIds: data.refs.map((ref) => ref.threadId),
                              ...threadDropAssignment(
                                data.refs.map((ref) => ref.threadId),
                                node,
                                env.organization,
                                model.liveThreads,
                                node.kind === "thread"
                                  ? event.clientY -
                                      event.currentTarget.getBoundingClientRect().top <
                                    event.currentTarget.getBoundingClientRect().height / 2
                                    ? "before"
                                    : "after"
                                  : "inside",
                              ),
                            }
                          : {
                              ...common,
                              type: "chatFolder.move" as const,
                              folderId: data.folderId,
                              parentId,
                              ...(beforeId ? { beforeId } : {}),
                            };
                      const liveIds = new Set(
                        [...model.liveThreads, ...hiddenThreads]
                          .filter((thread) => thread.environmentId === node.environmentId)
                          .map((thread) => thread.id),
                      );
                      decideOrganizationChange(
                        env.organization,
                        command,
                        new Date().toISOString(),
                        liveIds,
                      );
                      await performMove({ environmentId: env.id, input: command });
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : "Could not move folder.");
                    }
                  })();
                }}
              >
                {node.kind === "thread" ? (
                  <ul className="list-none">{renderThread(node.thread)}</ul>
                ) : (
                  <div
                    className="flex h-9 items-center gap-1 text-xs"
                    onContextMenu={(event) => {
                      event.preventDefault();
                      void menu(node, event.clientX, event.clientY);
                    }}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                      onClick={() => {
                        setFocusKey(node.key);
                        toggleExplorerNode(node.key);
                      }}
                    >
                      {expanded ? (
                        <ChevronDownIcon className="size-3 shrink-0" />
                      ) : (
                        <ChevronRightIcon className="size-3 shrink-0" />
                      )}
                      {expanded ? (
                        <FolderOpenIcon className="size-3.5 shrink-0" />
                      ) : (
                        <FolderIcon className="size-3.5 shrink-0" />
                      )}
                      <span className="truncate">
                        {node.kind === "folder"
                          ? node.folder.name
                          : node.kind === "unfiled"
                            ? "Unfiled"
                            : (environmentLabels.get(node.environmentId) ?? "Environment")}
                      </span>
                      {node.kind === "environment" && !env?.writable && (
                        <span className="text-[10px] text-muted-foreground">Read only</span>
                      )}
                      {summaries.get(node.key)?.status && (
                        <span
                          className={`ml-auto text-[10px] ${summaries.get(node.key)?.status?.colorClass}`}
                        >
                          {summaries.get(node.key)?.status?.label}
                        </span>
                      )}
                      {!!summaries.get(node.key)?.settled && (
                        <span className="text-[10px] text-muted-foreground">
                          {summaries.get(node.key)?.settled} settled
                        </span>
                      )}
                      {!!summaries.get(node.key)?.snoozed && (
                        <span className="text-[10px] text-muted-foreground">
                          {summaries.get(node.key)?.snoozed} snoozed
                        </span>
                      )}
                    </button>
                    {node.kind === "environment" && (
                      <button
                        type="button"
                        disabled={!env?.writable}
                        aria-label="Create root folder"
                        onClick={() =>
                          openFolderDialog({
                            kind: "create",
                            environmentId: node.environmentId,
                            parentId: null,
                          })
                        }
                      >
                        <PlusIcon className="size-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={!env?.writable}
                      aria-label="Folder actions"
                      className="px-1"
                      onClick={(event) => void menu(node, event.clientX, event.clientY)}
                    >
                      <MoreHorizontalIcon className="size-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          }}
        />
      </div>
      {dropTarget &&
        createPortal(
          <div
            role="status"
            className="pointer-events-none fixed z-[200] max-w-56 rounded border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
            style={{ left: dropTarget.x, top: dropTarget.y }}
          >
            {dropTarget.label}
          </div>,
          document.body,
        )}
      {error && (
        <p role="alert" className="p-2 text-xs text-destructive">
          {error}
          {retryMove && (
            <button
              type="button"
              className="ml-2 underline"
              disabled={pending}
              onClick={() => void performMove(retryMove)}
            >
              Retry move
            </button>
          )}
        </p>
      )}
      {pending && (
        <p role="status" className="p-2 text-xs">
          Moving…
        </p>
      )}
    </li>
  );
}

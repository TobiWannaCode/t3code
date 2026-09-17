import { useEffect, useRef } from "react";
import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ChatFolderId } from "@t3tools/contracts";
import { revealChatFolder, useExplorerUi, type ExplorerView } from "./state";

export function useExplorerRouteReveal({
  enabled,
  view,
  routeKey,
  routeFolder,
  routeVisible,
}: {
  enabled: boolean;
  view: ExplorerView;
  routeKey: string | null;
  routeFolder: ChatFolderId | null | undefined;
  routeVisible: boolean;
}) {
  const lastReveal = useRef("");
  useEffect(() => {
    if (!enabled || !routeKey) {
      lastReveal.current = "";
      return;
    }
    const state = useExplorerUi.getState();
    if (state.revealFolderFor === routeKey) return;
    if (state.revealFolderFor) useExplorerUi.setState({ revealFolderFor: null });
    // Revealing the active row may expand Chats, but lifecycle updates must
    // never select a different page, including when the last chat is parked.
    if (view !== "chats" || !routeVisible) return;
    const key = `${routeKey}:${routeFolder ?? "unfiled"}`;
    if (lastReveal.current === key) return;
    lastReveal.current = key;
    const ref = parseScopedThreadKey(routeKey);
    if (ref) revealChatFolder(ref);
  }, [enabled, view, routeKey, routeFolder, routeVisible]);
}

import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ChatFolderId } from "@t3tools/contracts";
import type { ExplorerView } from "./state";
import { useExplorerRouteReveal } from "./useExplorerRouteReveal";

const ui = vi.hoisted(() => ({
  state: { view: "chats" as ExplorerView, revealFolderFor: null as string | null },
  reveal: vi.fn(),
}));
vi.mock("./state", () => ({
  useExplorerUi: {
    getState: () => ui.state,
    setState: (patch: Partial<typeof ui.state>) => Object.assign(ui.state, patch),
  },
  revealChatFolder: ui.reveal,
}));

let renderer: ReactTestRenderer | undefined;
function Probe(props: Parameters<typeof useExplorerRouteReveal>[0]) {
  useExplorerRouteReveal(props);
  return null;
}
async function render(overrides: Partial<Parameters<typeof useExplorerRouteReveal>[0]> = {}) {
  const element = createElement(Probe, {
    enabled: true,
    view: ui.state.view,
    routeKey: "local:chat",
    routeFolder: null,
    routeVisible: true,
    ...overrides,
  });
  await act(async () => {
    if (renderer) renderer.update(element);
    else renderer = create(element);
  });
}
beforeEach(() => {
  ui.state = { view: "chats", revealFolderFor: null };
  ui.reveal.mockReset();
  ui.reveal.mockImplementation(() => {
    ui.state.view = "chats";
  });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

describe("Explorer route reveal", () => {
  it("keeps Chats selected when its open chat is parked, including the last chat", async () => {
    await render();
    expect(ui.reveal).toHaveBeenCalledOnce();
    ui.reveal.mockClear();
    // Settling, snoozing, and remote lifecycle updates remove the active row.
    await render({ routeVisible: false });
    expect(ui.state.view).toBe("chats");
    expect(ui.reveal).not.toHaveBeenCalled();
    // Waking the same chat also preserves the user's navigation/expansion.
    await render();
    expect(ui.reveal).not.toHaveBeenCalled();
  });

  it.each(["activity", "settled", "snoozed"] as const)(
    "keeps %s selected through lifecycle updates and conversation navigation",
    async (view) => {
      ui.state.view = view;
      await render({ routeVisible: false });
      await render();
      await render({ routeKey: "local:other" });
      expect(ui.state.view).toBe(view);
      expect(ui.reveal).not.toHaveBeenCalled();
    },
  );

  it("reveals active chats and new folder assignments only within Chats", async () => {
    await render({ routeVisible: false });
    expect(ui.reveal).not.toHaveBeenCalled();
    await render();
    await render({ routeFolder: ChatFolderId.make("moved") });
    expect(ui.reveal).toHaveBeenCalledTimes(2);
    expect(ui.reveal).toHaveBeenLastCalledWith({ environmentId: "local", threadId: "chat" });
  });

  it("respects an explicit Reveal folder request for a hidden chat", async () => {
    ui.state.revealFolderFor = "local:chat";
    await render({ routeVisible: false });
    await render();
    expect(ui.reveal).not.toHaveBeenCalled();
    await render({ routeKey: "local:other" });
    expect(ui.state.revealFolderFor).toBeNull();
    expect(ui.reveal).toHaveBeenCalledOnce();
  });
});

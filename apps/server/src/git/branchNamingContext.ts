import { assistantCitationsToPlainText } from "@t3tools/shared/assistantCitations";
import type { OrchestrationMessage } from "@t3tools/contracts";

export function truncateBranchContext(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const marker = "\n[truncated]";
  let end = Math.max(0, limit - marker.length);
  if (/[\uD800-\uDBFF]/u.test(text[end - 1] ?? "")) end--;
  return text.slice(0, end) + marker;
}

export function branchNamingContext(messages: readonly OrchestrationMessage[]): string {
  const complete = messages.filter(
    (m) => !m.streaming && (m.role === "user" || m.role === "assistant"),
  );
  const users = complete.filter((m) => m.role === "user" && m.text.trim());
  const first = users[0];
  const latest = users.at(-1);
  if (!first || !latest) throw new Error("Insufficient text context to name this branch.");
  const selected = new Map<string, string>();
  const render = (m: OrchestrationMessage, limit: number) =>
    truncateBranchContext(
      `${m.role}: ${assistantCitationsToPlainText(m.text)}${m.attachments?.length ? `\nAttachments: ${m.attachments.map((a) => a.name).join(", ")}` : ""}`,
      limit,
    );
  selected.set(first.id, render(first, first.id === latest.id ? 8000 : 4000));
  if (latest.id !== first.id) selected.set(latest.id, render(latest, 8000));
  let remaining = 24000 - [...selected.values()].reduce((sum, text) => sum + text.length + 2, 0);
  for (let i = complete.length - 1; i >= 0 && remaining > 32; i--) {
    const message = complete[i]!;
    if (selected.has(message.id)) continue;
    const text = render(message, remaining - 2);
    selected.set(message.id, text);
    remaining -= text.length + 2;
  }
  return complete
    .filter((m) => selected.has(m.id))
    .map((m) => selected.get(m.id))
    .join("\n\n");
}

export const branchNamingWatermark = (messages: readonly OrchestrationMessage[]) => {
  const latest = messages.findLast((message) => message.role === "user");
  return latest ? `${latest.id}:${latest.updatedAt}` : "";
};

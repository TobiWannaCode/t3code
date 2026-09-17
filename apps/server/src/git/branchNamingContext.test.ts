import { expect, it } from "vite-plus/test";
import { MessageId, type OrchestrationMessage } from "@t3tools/contracts";
import { branchNamingContext, truncateBranchContext } from "./branchNamingContext.ts";
const message = (
  id: string,
  role: OrchestrationMessage["role"],
  text: string,
  streaming = false,
): OrchestrationMessage => ({
  id: MessageId.make(id),
  role,
  text,
  streaming,
  turnId: null,
  createdAt: "now",
  updatedAt: "now",
});
it("keeps original request and latest correction in chronological bounded context", () => {
  const context = branchNamingContext([
    message("a", "user", "first " + "a".repeat(50000)),
    message("b", "assistant", "b".repeat(50000)),
    message("c", "system", "DO NOT INCLUDE"),
    message("d", "assistant", "STREAM", true),
    message("e", "user", "latest correction " + "c".repeat(50000)),
  ]);
  expect(context.length).toBeLessThanOrEqual(24000);
  expect(context.startsWith("user: first")).toBe(true);
  expect(context).toContain("latest correction");
  expect(context).not.toContain("DO NOT INCLUDE");
  expect(context).not.toContain("STREAM");
});
it("deduplicates endpoints, rejects image-only regeneration and preserves Unicode boundaries", () => {
  expect(branchNamingContext([message("a", "user", "fix login")])).toBe("user: fix login");
  expect(() => branchNamingContext([message("a", "user", "")])).toThrow("Insufficient");
  const result = truncateBranchContext("😀".repeat(100), 30);
  expect(result).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
});

import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { BranchNamingRulesEditor } from "./BranchNamingRulesEditor";

vi.mock("~/components/ui/button", () => ({ Button: "button" }));
vi.mock("~/components/ui/input", () => ({ Input: "input" }));
const policy = {
  rules: [{ id: "rule", template: "Team/{AI_MESSAGE}-WIP", description: "All changes" }],
  fallbackRuleId: null,
};
let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount());
  renderer = undefined;
});
it("preserves a draft after save failure, then saves it successfully", async () => {
  const onSave = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(undefined);
  await act(async () => {
    renderer = create(<BranchNamingRulesEditor value={policy} onSave={onSave} />);
  });
  const format = () =>
    renderer!.root.findAllByType("input").find((input) => input.props.maxLength === 200)!;
  const save = () =>
    renderer!.root.findAllByType("button").find((button) => button.props.children === "Save")!;
  await act(async () => format().props.onChange({ target: { value: "test/etl/{AI_MESSAGE}" } }));
  await act(async () => save().props.onClick());
  expect(renderer!.root.findByProps({ role: "alert" }).props.children).toBe("Offline");
  expect(format().props.value).toBe("test/etl/{AI_MESSAGE}");
  expect(save().props.disabled).toBe(false);
  await act(async () => save().props.onClick());
  expect(onSave).toHaveBeenLastCalledWith({
    ...policy,
    rules: [{ ...policy.rules[0], template: "test/etl/{AI_MESSAGE}" }],
  });
  expect(save().props.disabled).toBe(true);
});
it("blocks invalid formats and cancels back to saved rules", async () => {
  const onSave = vi.fn();
  await act(async () => {
    renderer = create(<BranchNamingRulesEditor value={policy} onSave={onSave} />);
  });
  const format = () =>
    renderer!.root.findAllByType("input").find((input) => input.props.maxLength === 200)!;
  await act(async () => format().props.onChange({ target: { value: "no-token" } }));
  const buttons = renderer!.root.findAllByType("button");
  expect(buttons.find((button) => button.props.children === "Save")!.props.disabled).toBe(true);
  await act(async () =>
    buttons.find((button) => button.props.children === "Cancel")!.props.onClick(),
  );
  expect(format().props.value).toBe("Team/{AI_MESSAGE}-WIP");
  expect(onSave).not.toHaveBeenCalled();
});

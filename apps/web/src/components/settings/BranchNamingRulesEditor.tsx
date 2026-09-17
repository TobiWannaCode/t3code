import { randomUUID } from "../../lib/utils";
import { useEffect, useState } from "react";
import type { BranchNamingPolicy } from "@t3tools/contracts";
import { buildBranchNameCandidate, validateBranchNamingPolicy } from "@t3tools/shared/branchNaming";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

const emptyPolicy = (): BranchNamingPolicy => ({
  rules: [{ id: randomUUID(), template: "{AI_MESSAGE}", description: "All work in this project" }],
  fallbackRuleId: null,
});
const preview = (template: string) => {
  try {
    return buildBranchNameCandidate(template, "example-change");
  } catch {
    return "Enter a valid format to preview";
  }
};

export function BranchNamingRulesEditor({
  value,
  mixed = false,
  onSave,
}: {
  value: BranchNamingPolicy | null;
  mixed?: boolean;
  onSave: (value: BranchNamingPolicy | null) => Promise<void>;
}) {
  const saved = JSON.stringify(value);
  const [base, setBase] = useState(saved);
  const [draft, setDraft] = useState<BranchNamingPolicy | null>(value);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const dirty = JSON.stringify(draft) !== base;
  useEffect(() => {
    if (!dirty && saved !== base) {
      setBase(saved);
      setDraft(value);
    }
  }, [saved, base, dirty, value]);
  const validation = validateBranchNamingPolicy(draft);
  const reset = () => {
    setDraft(value);
    setBase(saved);
    setError(null);
    setSuccess(false);
  };
  const editRule = (id: string, patch: { template?: string; description?: string }) => {
    if (draft)
      setDraft({
        ...draft,
        rules: draft.rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
      });
    setSuccess(false);
  };
  const reorder = (index: number, delta: number) => {
    if (!draft) return;
    const rules = [...draft.rules];
    [rules[index], rules[index + delta]] = [rules[index + delta]!, rules[index]!];
    setDraft({ ...draft, rules });
  };
  return (
    <div className="space-y-4 text-sm">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={draft !== null}
          disabled={pending}
          onChange={(event) => {
            setDraft(event.target.checked ? (value ?? emptyPolicy()) : null);
            setSuccess(false);
          }}
        />
        Use custom branch formats
      </label>
      {!draft && (
        <p className="text-muted-foreground">Using the existing branch naming conventions.</p>
      )}
      {draft && (
        <>
          <p className="text-muted-foreground">
            Use exactly one <code>{"{AI_MESSAGE}"}</code> in each format. AI selects a rule using
            its description. Earlier rules win ties.
          </p>
          <fieldset disabled={pending} className="space-y-3">
            {draft.rules.map((rule, index) => (
              <div key={rule.id} className="space-y-2 rounded-lg border p-3">
                <label className="block space-y-1">
                  <span>Format {index + 1}</span>
                  <Input
                    value={rule.template}
                    maxLength={200}
                    onChange={(event) => editRule(rule.id, { template: event.target.value })}
                  />
                </label>
                <label className="block space-y-1">
                  <span>Use when</span>
                  <Input
                    value={rule.description}
                    maxLength={1000}
                    onChange={(event) => editRule(rule.id, { description: event.target.value })}
                  />
                </label>
                <p className="break-all text-xs text-muted-foreground">
                  Preview: <code>{preview(rule.template)}</code>
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={index === 0}
                    onClick={() => reorder(index, -1)}
                  >
                    Move up
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={index === draft.rules.length - 1}
                    onClick={() => reorder(index, 1)}
                  >
                    Move down
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setDraft({
                        rules: draft.rules.filter((r) => r.id !== rule.id),
                        fallbackRuleId:
                          draft.fallbackRuleId === rule.id ? null : draft.fallbackRuleId,
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              disabled={draft.rules.length >= 50}
              onClick={() =>
                setDraft({
                  ...draft,
                  rules: [...draft.rules, { id: randomUUID(), template: "", description: "" }],
                })
              }
            >
              Add rule
            </Button>
            <label className="block space-y-1">
              <span>If no rule clearly matches</span>
              <select
                className="block w-full rounded-md border bg-background p-2"
                value={draft.fallbackRuleId ?? ""}
                onChange={(event) =>
                  setDraft({ ...draft, fallbackRuleId: event.target.value || null })
                }
              >
                <option value="">Leave the name unchanged</option>
                {draft.rules.map((rule, index) => (
                  <option key={rule.id} value={rule.id}>
                    {index + 1}. {rule.template}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
        </>
      )}
      {saved !== base && dirty && (
        <p role="status">
          Saved settings changed in another window. Your draft is preserved.{" "}
          <Button size="sm" variant="outline" onClick={reset}>
            Reload saved settings
          </Button>
        </p>
      )}
      {(validation || error) && (
        <p role="alert" className="text-destructive">
          {error ?? validation}
        </p>
      )}
      {success && !dirty && <p role="status">Branch naming settings saved.</p>}
      <div className="flex gap-2">
        <Button
          disabled={pending || (!dirty && !mixed) || !!validation}
          onClick={async () => {
            setPending(true);
            setError(null);
            try {
              await onSave(draft);
              setBase(JSON.stringify(draft));
              setSuccess(true);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Could not save settings.");
            } finally {
              setPending(false);
            }
          }}
        >
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button variant="outline" disabled={pending || !dirty} onClick={reset}>
          Cancel
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Formats: up to 200 UTF-8 bytes. Generated text: up to 64 characters. Names are changed
        locally; remote branches and PRs keep their existing names.
      </p>
    </div>
  );
}

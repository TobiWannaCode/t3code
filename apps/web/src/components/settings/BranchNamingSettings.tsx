import { BranchNamingRulesEditor } from "./BranchNamingRulesEditor";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useSettingsScope } from "./SettingsScopeContext";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

export function BranchNamingSettingsSection() {
  const value = useScopedSettings((settings) => settings.branchNaming);
  const mixed = useScopedSettingsMixed(["branchNaming"]);
  const update = useUpdateScopedSettings();
  const { search } = useSettingsScope();
  return (
    <SettingsSection title="Branch naming">
      <SettingsRow
        {...searchableSetting("branch-naming")}
        title="Branch naming rules"
        serverScoped
        settingKeys={["branchNaming"]}
        description="Choose formats for generated branch names. Project settings can override these defaults."
      >
        {mixed && (
          <p className="mb-3 text-sm text-muted-foreground">
            Selected targets have different rules. Saving applies this draft to every selected
            target.
          </p>
        )}
        <BranchNamingRulesEditor
          key={JSON.stringify(search)}
          value={value}
          mixed={mixed}
          onSave={async (branchNaming) => {
            if (!(await update({ branchNaming })))
              throw new Error(
                "Could not save rules on every selected environment. Your draft is preserved.",
              );
          }}
        />
      </SettingsRow>
    </SettingsSection>
  );
}

import { BranchNamingSettingsSection } from "./BranchNamingSettings";
import { SourceControlWritingSettingsSection } from "./SourceControlWritingSettings";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export function ConventionsSettingsPanel() {
  return (
    <SettingsPageContainer>
      <SettingsSection
        id={searchableSetting("repository-conventions").id}
        title="Repository conventions"
      >
        <div className="space-y-3 px-4 py-3 text-sm text-muted-foreground">
          <p>
            Keep shared rules in <code>.conventions.json</code> at your Git repository root. Version
            1 supports branch names, commit messages, and pull request titles and descriptions.
          </p>
          <p>
            Each section in the file takes priority over the defaults below. Missing sections use
            project settings, then environment defaults. Commit the file so new worktrees inherit
            it.
          </p>
          <p>
            Reference the file in <code>AGENTS.md</code> so coding agents follow the same rules when
            working directly with Git. T3 Code reads the file automatically for its generated names
            and messages.
          </p>
        </div>
      </SettingsSection>
      <BranchNamingSettingsSection />
      <SourceControlWritingSettingsSection />
    </SettingsPageContainer>
  );
}

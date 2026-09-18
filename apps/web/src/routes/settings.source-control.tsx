import { createFileRoute, redirect } from "@tanstack/react-router";

import { SourceControlSettingsPanel } from "../components/settings/SourceControlSettings";

export const Route = createFileRoute("/settings/source-control")({
  beforeLoad: ({ location, search }) => {
    if (
      [
        "branch-naming",
        "source-control-writing-style",
        "follow-change-request-templates",
        "source-control-writer-model",
        "source-control-text-generation",
      ].includes(location.hash)
    ) {
      throw redirect({ to: "/settings/conventions", hash: location.hash, search, replace: true });
    }
  },
  component: SourceControlSettingsPanel,
});

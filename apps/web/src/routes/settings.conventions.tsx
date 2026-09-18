import { createFileRoute } from "@tanstack/react-router";
import { ConventionsSettingsPanel } from "../components/settings/ConventionsSettings";

export const Route = createFileRoute("/settings/conventions")({
  component: ConventionsSettingsPanel,
});

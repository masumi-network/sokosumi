import { normalizeFileLabelName } from "./file-vocabulary.js";

export const TASK_TAG_PRESETS = [
  {
    displayName: "Bug",
    description:
      "Find, reproduce, or fix a defect where existing behavior differs from the expected result.",
  },
  {
    displayName: "Incident",
    description:
      "Respond to a service disruption, assess its impact, restore service, or document the incident.",
  },
  {
    displayName: "Experiment",
    description:
      "Test a hypothesis with a trial or comparison and use the result to decide what to try next.",
  },
  {
    displayName: "Decision",
    description:
      "Choose between alternatives and record the trade-offs behind the choice.",
  },
  {
    displayName: "Handoff",
    description:
      "Transfer ownership of work with the context and next steps the recipient needs.",
  },
].map((tag) => ({
  ...tag,
  kind: "TAG" as const,
  normalizedName: normalizeFileLabelName(tag.displayName),
}));

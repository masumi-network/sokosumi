import type { SokoBotCapability } from "./policy.js";

/**
 * Agent presets: a versioned combination of model, tool allowlist, and
 * extra system guidance. Presets live in git so a change is a reviewable
 * diff; the behaviour lab runs the same scenarios against each of them.
 * Add a new entry rather than editing one that has lab history.
 */
export interface SokoBotPreset {
  id: string;
  name: string;
  description: string;
  /** AI Gateway model id; resolved per session by the Eve runtime. */
  model: string;
  /** Tool allowlist applied on top of the route ceiling; omit for all. */
  capabilities?: readonly SokoBotCapability[];
  /** Extra system instructions appended per turn. */
  instructions?: string;
  /** Eve skills this preset relies on (documentation for now). */
  skills?: readonly string[];
}

export const SOKO_BOT_PRESETS: readonly SokoBotPreset[] = [
  {
    id: "large-3",
    name: "Mistral Large 3",
    description: "Baseline: Mistral Large 3, all tools, standard instructions.",
    model: "mistral/mistral-large-3",
  },
  {
    id: "medium-3.5",
    name: "Mistral Medium 3.5",
    description: "Newer mid-size Mistral model, all tools.",
    model: "mistral/mistral-medium-3.5",
  },
  {
    id: "devstral-2",
    name: "Devstral 2",
    description: "Mistral's agentic/tool-use tuned model, all tools.",
    model: "mistral/devstral-2",
  },
  {
    id: "large-3-strict",
    name: "Mistral Large 3 · strict tools",
    description:
      "Large 3 with an explicit read-before-write rule and a reminder that tool calls are structured, not text.",
    model: "mistral/mistral-large-3",
    instructions: [
      "Before any Task mutation, call get_task_status on that Task in this turn.",
      "Tools are invoked through the tool-call mechanism only. Never write a tool name or JSON arguments into your reply text.",
      "Every id you mention must appear verbatim in a tool result or the context packet of this turn.",
    ].join("\n"),
  },
];

export const DEFAULT_SOKO_BOT_PRESET_ID = "large-3";

export function getSokoBotPreset(id: string | null | undefined): SokoBotPreset {
  const preset = SOKO_BOT_PRESETS.find((candidate) => candidate.id === id);
  if (preset) return preset;
  const fallback = SOKO_BOT_PRESETS.find(
    (candidate) => candidate.id === DEFAULT_SOKO_BOT_PRESET_ID,
  );
  if (!fallback) throw new Error("Default Soko Bot preset is missing");
  return fallback;
}

export function isSokoBotPresetId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    SOKO_BOT_PRESETS.some((preset) => preset.id === value)
  );
}

/** Route ceiling ∩ preset allowlist; scratch tools always stay. */
export function applyPresetCapabilities(
  preset: SokoBotPreset,
  capabilities: readonly SokoBotCapability[],
): SokoBotCapability[] {
  if (!preset.capabilities) return [...capabilities];
  const allowed = new Set<SokoBotCapability>(preset.capabilities);
  return capabilities.filter(
    (capability) =>
      allowed.has(capability) || capability.startsWith("scratch_"),
  );
}

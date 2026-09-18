export interface CoworkerPreset {
  id: string;
  label: string;
}

export const COWORKER_FRAMEWORK_PRESETS: readonly CoworkerPreset[] = [
  {
    id: "pi-sokosumi",
    label: "pi-sokosumi",
  },
  {
    id: "eve",
    label: "Eve",
  },
  {
    id: "hermes",
    label: "Hermes",
  },
  {
    id: "openclaw",
    label: "OpenClaw",
  },
];

export function describeRegisterNextStep(preset: CoworkerPreset): string {
  return `${preset.label} is a Coworker runtime, not a Hire Agent. Connecting it to one Organization workspace (Sokosumi chat + Tasks) is the next CLI slice.`;
}

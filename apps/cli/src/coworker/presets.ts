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
  return `${preset.label} is a Coworker runtime, not a Hire Agent. An organizer provisions its Coworker ID first. Use \`coworkers connect\` for the Workspace. Sokosumi chat + Tasks still need a runtime adapter.`;
}

export const COWORKER_FRAMEWORK_PRESETS = [
  {
    id: "pi-sokosumi",
    key: "1",
    label: "pi-sokosumi",
  },
  {
    id: "eve",
    key: "2",
    label: "Eve",
  },
  {
    id: "hermes",
    key: "3",
    label: "Hermes",
  },
  {
    id: "openclaw",
    key: "4",
    label: "OpenClaw",
  },
];

export function presetForKey(key) {
  return (
    COWORKER_FRAMEWORK_PRESETS.find((preset) => preset.key === String(key)) ||
    null
  );
}

export function describeRegisterNextStep(preset) {
  return `${preset.label} is a Coworker runtime, not a Hire Agent. Connecting it to one Organization workspace (Sokosumi chat + Tasks) is the next CLI slice.`;
}

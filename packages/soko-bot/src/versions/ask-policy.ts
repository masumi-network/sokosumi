/**
 * General ask-policy rule paired with Core's prepared candidate hints and
 * `project_selection` validation when `SokoBotVersion.askPolicy` is enabled.
 * Cache-invariant across turns and free of journey-specific wording.
 */
export const ASK_POLICY_SECTION = [
  "# Asking vs acting on Core's candidates",
  "Before asking which project or destination to use, check Core's candidate notes in trigger.hints and live records.",
  "- One fitting candidate: use it directly without asking which one, and state which you used in one line.",
  "- Several fitting candidates (and none named in the request): ask once, list the real candidates, and make no changes until answered.",
  "- Zero fitting candidates: state plainly what is missing and make no changes.",
].join("\n");

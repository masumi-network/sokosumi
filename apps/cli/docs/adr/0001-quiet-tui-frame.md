# ADR 0001: One quiet frame for the CLI TUI

- Status: Accepted
- Date: 2026-09-15

[VERIFIED] SOK-1139 (supersedes canceled SOK-1069), “Minimal developer TUI,” requires one contextual header, one body focus surface, one footer keymap, and secondary Register presentation. It requires preserving auth, navigation, resource fetching, detail views, keyboard transitions, Ink, and the semantic TUI theme.

[DECISION, user-approved 2026-09-14] The CLI TUI uses one outer frame with one contextual header, one body focus surface, and one footer keymap. It does not reintroduce nested title/status borders, duplicate resource menus, or repeated pane hints.

## Consequences

- Arrow and Enter selection, Esc back, q quit, live Core data, and existing auth boundaries remain unchanged.
- Register remains a secondary preset-only action.
- The TUI stays Ink/React. HTML/CSS runtime and prototype fixtures remain out of scope.
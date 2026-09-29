# ADR 0001: One quiet frame for the CLI TUI

- Status: Accepted
- Date: 2026-09-15

[VERIFIED] SOK-1069, “Simplify CLI TUI to one quiet frame,” requires one contextual header, one body focus surface, and one footer keymap. It requires preserving auth, navigation, resource fetching, detail views, keyboard transitions, Ink, and the semantic TUI theme.

[DECISION, user-approved 2026-09-14] The CLI TUI uses one outer frame with one contextual header, one body focus surface, and one footer keymap. It does not reintroduce nested title/status borders, duplicate resource menus, or repeated pane hints.

[CORRECTION, VERIFIED: CLI source] Signed-in TUI lists Vendors, Workspaces, and Sign out. Vendor and Workspace screens are read-only review lists. Coworker create is headless `coworkers register`, not a TUI Register preset menu.

## Consequences

- Arrow and Enter selection, Esc back, q quit, live Core data, and existing auth boundaries remain unchanged.
- Vendor and Workspace screens are review surfaces, not Register choosers.
- The TUI stays Ink/React. HTML/CSS runtime and prototype fixtures remain out of scope.
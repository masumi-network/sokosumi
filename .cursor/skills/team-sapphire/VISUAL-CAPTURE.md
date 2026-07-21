# Visual Capture (Reviewer)

**Load only when UI in scope** = Spec Verification lists ≥1 path-only route. Otherwise skip this file and skip screenshots.

## Do

1. Use only those Spec routes (no inventing URLs).
2. Capture the happy path via Browser Automation MCP (`browser_take_screenshot`) or Cloud Agent computer-use artifacts on the PR. Capture extra states (dark / empty / error) **only** when Spec Verification lists them.
3. Sign-in and selectors: `apps/web/AGENTS.md` → **Browser Automation**.
4. Cloud runtime notes (ports, env): root `AGENTS.md` → **Cursor Cloud specific instructions**.

## Skip

- Spec Verification has no path-only routes
- Stacking multiple capture tools for the same flow

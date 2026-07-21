# Visual Capture (Reviewer)

**Load only when UI is in scope.** Backend-only PRs: skip this file and skip screenshots.

## Do

1. Use path-only routes from the Spec (no inventing URLs).
2. Capture happy path via Browser Automation MCP (`browser_take_screenshot`) or Cloud Agent computer-use artifacts on the PR.
3. Sign-in and selectors: `apps/web/AGENTS.md` → **Browser Automation**.
4. Cloud runtime notes (ports, env): root `AGENTS.md` → **Cursor Cloud specific instructions**.

## Skip

- Backend / API / schema-only PRs
- Stacking multiple capture tools for the same flow

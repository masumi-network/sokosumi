# Design: Harden header workspace avatar sizing

**Date:** 2026-08-05  
**Status:** Approved approach A  
**Scope:** Closed header top-right workspace switcher (name + avatar + chevron) next to notification bell

## Problem

Personal-account avatar in the closed header switcher renders much larger than the org-workspace logo. That breaks vertical alignment with the chevron and notification bell and makes the two-line name/email block look uneven.

### Root cause

`HeaderWorkspaceSwitch` passes `className="size-4 shrink-0"` into `HeaderWorkspaceAvatar`.

- **Org path:** wraps `OrganizationLogo` in `Avatar` with that className only → stays `size-4` (16px). Correct.
- **Personal path:** uses `UserAvatarContent`, which hardcodes:

  ```ts
  cn("size-8 md:size-10", className)
  ```

  `tailwind-merge` lets bare `size-4` override `size-8`, but **not** the responsive `md:size-10`. At `md+`, personal avatar becomes 40px while org stays 16px.

## Goal

- Closed switcher avatar is always **compact `size-4` (16px)** for personal and org.
- Icon/avatar intrinsic size must not reflow the header chrome (chevron, bell, two-line label).
- Callers of `UserAvatarContent` can fully override size via `className`.

## Non-goals

- Dropdown menu workspace avatars (`size-6`)
- Notification bell hit target (`size-8`)
- Sidebar account chip or other avatars outside the closed header switcher
- Changing label truncation, email row, or switcher interaction

## Approach (A — fix size merge at source)

### 1. `UserAvatarContent`

Change default sizing so caller classes win completely:

```ts
// before
cn("size-8 md:size-10", className)

// after
cn("size-8", className)
```

- Default remains `size-8` when no size class is passed (skeleton / generic use).
- Header `size-4` fully wins; no leftover responsive size.
- Keep `AvatarImage` `size-full object-cover` so image fills the box.

### 2. Header closed switcher (light harden)

Keep existing trigger API:

- `HeaderWorkspaceAvatar` with `className="size-4 shrink-0"`, `logoSize={12}`, `decorative` for closed trigger.
- Ensure personal and org paths both respect the same outer size (org already does via `Avatar` + className; personal does after step 1).

No layout redesign of the grid (`name | avatar | chevron` + email row).

### 3. Tests

- Unit/render test: closed switcher (or `HeaderWorkspaceAvatar` personal path) with `className="size-4"` must **not** include `md:size-10` / `size-8 md:size-10` on the avatar root.
- Optionally assert `size-4` (or `size-4 shrink-0`) is present.
- Existing profile-section / notification tests stay as-is unless they mock avatar markup.

## Success criteria

| Case | Expected |
| --- | --- |
| Personal workspace, closed switcher | Avatar `size-4`, aligned with chevron/bell (matches Image #1 density) |
| Org workspace, closed switcher | Unchanged small logo (`size-4`) |
| `UserAvatarContent` with no className size | Default `size-8` |
| Dropdown menu rows | Still `size-6` avatars |
| `md+` viewport | No personal-avatar jump to `size-10` |

## Risks

| Risk | Mitigation |
| --- | --- |
| Skeleton lost `md:size-10` | Skeleton sits in fixed `h-8 w-8` button; `size-8` default matches. |
| Other future callers assumed `md:size-10` | Only header + skeleton use `UserAvatarContent` today; grep-confirmed. |
| Regression of hardcoded sizes | Test locks override behavior for `size-4`. |

## Implementation order

1. Fix `UserAvatarContent` default classes + add/adjust unit test.
2. Smoke header switcher personal vs org (visual or render assertion).
3. No Core/API or i18n changes.

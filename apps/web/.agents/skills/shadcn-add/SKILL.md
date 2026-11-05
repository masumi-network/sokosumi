---
name: shadcn-add
description: Add a shadcn/ui component or block to apps/web in the Masumi design system. Use when running `shadcn add` or copying code from ui.shadcn.com.
---

# Add a shadcn component

`src/app/globals.css` is the theme: every shadcn colour already holds a Masumi value. Upstream components still carry upstream classes, so each one is adapted on the way in.

Start from a clean tree, so step 2 can restore everything the CLI touched.

## Steps

1. Look in `src/components/ui/` first. An existing component, or a variant of one, ends the job here.

2. Run the CLI from `apps/web`. `--yes` still asks before replacing each existing file, and `yes n` keeps our adapted copy:

   ```bash
   yes n | npx --yes shadcn@latest add <name> --yes
   ```

   Note any package it added to `apps/web/package.json` other than `cn`, then restore everything tracked from the repo root. Even with "no", the CLI rewrites imports in existing components:

   ```bash
   git restore -- apps/web/package.json pnpm-lock.yaml apps/web/src/components/ui apps/web/src/app/globals.css
   pnpm install --frozen-lockfile
   ```

   Install the packages you noted, from the repo root, pinned as the repo pins them:

   ```bash
   pnpm --filter web add --save-exact <package>
   ```

   Done when `git status` shows only new component files, plus `package.json` and the lockfile if you installed a package.

   `globals.css` stays ours. A token the component needs and the theme lacks goes in by hand, following **Adding a token** in [color-tokens](../../../../../.cursor/rules/color-tokens.mdc).

3. Apply every row of **Swaps** to every new file.

4. Check from `apps/web`:

   ```bash
   npx vitest run src/lib/utils/__tests__/src-walk-guards.test.ts
   pnpm typecheck
   ```

   A guard failure names the file, line and rule. Fix it with the role table in [color-tokens](../../../../../.cursor/rules/color-tokens.mdc), and add a row to **Swaps** when the pattern will recur.

5. Render the component where it will be used, and screenshot it in light and dark.

Done when the guards are green, types pass and both screenshots look calm.

## Swaps

| Upstream                                                  | House                                              |
| --------------------------------------------------------- | -------------------------------------------------- |
| `import { cn } from "cn"`                                 | `import { cn } from "@/lib/utils"`                 |
| `focus-visible:ring-[3px] focus-visible:ring-ring/50`     | `focus-visible:ring-2 focus-visible:ring-ring`     |
| The same pair under another variant, such as `has-[…]:`   | The same swap, keeping the variant                 |
| `aria-invalid:ring-destructive/20`, its `dark:` twin      | Delete; `aria-invalid:border-destructive` marks it |
| `bg-black/50` behind a dialog or drawer                   | `bg-overlay`                                       |
| `data-[variant=destructive]:focus:bg-destructive/10`      | `data-[variant=destructive]:focus:bg-muted`        |
| `dark:data-[variant=destructive]:focus:bg-destructive/20` | `dark:data-[variant=destructive]:focus:bg-quinary` |
| `bg-accent/50`, `bg-muted/50`                             | `bg-accent`, `bg-muted`                            |
| `hover:text-primary` on a link                            | `hover:text-foreground`                            |
| `border-primary` with `bg-primary/5` when checked         | `border-foreground` with `bg-muted`                |
| `border-input` on a button or toggle                      | `border-control-border`                            |
| `backdrop-blur-*`                                         | Delete; `bg-overlay` is the whole scrim            |
| `dark:bg-input/30`, `shadow-xs`                           | Delete                                             |
| `transition-[color,box-shadow]`, `transition-all`         | `transition-[color,background-color]`              |
| `h-4 w-4`                                                 | `size-4`                                           |
| `80vh`                                                    | `80dvh`                                            |

The `cn` package on npm is unrelated to our helper, so it never joins `package.json`.

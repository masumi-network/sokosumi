---
name: translations
description: Use when deleting or modifying code that uses useTranslations() or getTranslations(), when adding/removing/renaming keys in messages/en.json, or when working with messages/*.json locale files.
---

# Translation Cleanup (next-intl)

## Overview

When code that uses translations is deleted or modified, check for and remove unused translation keys from `messages/en.json`. When keys in `messages/en.json` change, synchronize every supported locale file. Prevents orphaned keys and keeps locale catalogs in parity.

## Supported locales

`en` (source of truth), `de`, `es` — `apps/web/messages/{en,de,es}.json`.

Parity: `pnpm --filter web messages:parity` (write: `messages:parity:write`). Wired into web `test`.

## Client message bags

Layouts nest `ClientMessageBoundary` so clients get a picked subset (`pickMessages` + `message-namespaces.ts`), not the full catalog. Server `getTranslations` still uses the full request catalog.

Bags: `GLOBAL`, `AUTH`, `APP` (no Hermes/Admin), nested `HERMES`/`ADMIN` (`APP_SHELL` + feature), `SHARE`. Add new client namespaces to the owning bag when needed.

## Translation Usage Patterns

Client components: `useTranslations()`. Server components / metadata: `getTranslations()` from `next-intl/server`. Both resolve the same key paths in `messages/en.json`.

```typescript
const t = useTranslations("CookieConsent");
return <h1>{t("title")}</h1>; // → CookieConsent.title
```

```typescript
const t = await getTranslations("Share.Metadata");
```

Nested paths:

```typescript
const t = useTranslations("Components");
return <h1>{t("ShareButton.share")}</h1>; // → Components.ShareButton.share
```

## Cleanup When Code is Deleted

1. **Identify deleted usage**: From deleted code, find `useTranslations(` / `getTranslations(` and all `t('key')` / `t('nested.key')` and map to full keys in `messages/en.json`.
2. **Check if keys are still used**: Search the codebase for each key (full path, and namespace + key, e.g. `ShareButton.share` with `Components`).
3. **Remove unused keys**: Remove from `messages/en.json`, then remove empty parent objects. Preserve JSON structure.

### Key search patterns

- `useTranslations("CookieConsent")` or `getTranslations("CookieConsent")` + `t("title")` → `CookieConsent.title`
- `useTranslations("Components")` + `t("ShareButton.share")` → `Components.ShareButton.share`
- Direct string: `"CookieConsent.title"`

### Example

After deleting a component that used `CookieConsent.title`:

1. Search for `CookieConsent.title` and `t("title")` next to a `CookieConsent` namespace. If no matches, remove the key from `messages/en.json`.
2. If the whole `CookieConsent` object is unused, remove it; remove empty parent objects as needed.

## When `messages/en.json` Keys Change

`apps/web/messages/en.json` is source of truth. Any key add/remove/rename must be applied to every supported locale.

**Locale files**: `de.json`, `es.json` (under `apps/web/messages/`).

- **Add key**: Add to `en.json`, then add same path to every locale with **proper translations** in each non-English file (see Locale string quality).
- **Remove key**: Remove from `en.json`, then remove same path from every locale; remove empty parent objects.
- **Rename/move key**: Apply same rename/move in `en.json` and in every locale; preserve values per locale.

## Locale string quality

`apps/web/messages/en.json` is source of truth for **key paths** and the only catalog authored in English.

Non-English files (`de`, `es`) must use **real translations** for user-facing strings—not English left as the final value.

### ✅ DO

- Write new or changed copy in each locale’s language in the **same PR** as `en.json`.
- Match terminology already used in that locale file.
- Preserve `{placeholders}`, ICU plural/select syntax, and JSON structure across locales.

### ❌ DON'T

- Ship non-English locale files with English text unless explicitly deferred (document why; fix before release).
- Leave English placeholders in non-English files without replacing them before finishing the task.

English in non-`en` files is only a **short-lived placeholder** while wiring keys. Replace before merge, or call out deferral.

For `@sokosumi/email` locales, use `packages/email/AGENTS.md` instead of this web catalog.

## Rules

### ✅ DO

- Check for unused translations when deleting code; search codebase before removing keys.
- Remove empty parent objects after removing all children.
- Preserve JSON formatting and handle nested keys (full path and namespace + key).
- Keep locale key paths in sync; add/update/remove in all locale catalogs in the same change.
- Provide real translations in non-English locale files when adding or changing user-facing strings.

### ❌ DON'T

- Remove keys without verifying they are unused.
- Remove parent objects that still have used children.
- Add keys only in `messages/en.json` and leave other locale files missing them.
- Rename/move keys in `en.json` without applying the same path change to all locales.
- Leave English placeholder text in non-English locale files as the final merged state.

## Verification

After changes:

1. JSON valid for all locale files.
2. `pnpm --filter web messages:parity`.
3. Non-English locale values are translated (not English copies left as final state).
4. No broken references in code.
5. Run `pnpm web:format`.

## Tools

```bash
# Find translation usages
grep -rE "useTranslations|getTranslations" apps/web/src --include="*.tsx" --include="*.ts"

# List all keys
jq -r 'paths(scalars) as $p | $p | join(".")' apps/web/messages/en.json

# Spot-check one key across locales (replace KEY path)
KEY='CookieConsent.title'
for locale in de es; do
  echo "$locale: $(jq -r --arg k "$KEY" 'getpath($k | split("."))' apps/web/messages/$locale.json)"
done
jq -r --arg k "$KEY" 'getpath($k | split("."))' apps/web/messages/en.json
```

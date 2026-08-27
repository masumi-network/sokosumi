# Sokosumi Email Package Agent Guidelines

> **Purpose**: This document provides package-specific guidelines for AI agents working on the shared email package. For monorepo-wide guidance, see the [root AGENTS.md](../../AGENTS.md).

## Package Scope

- This package owns the shared email renderers and email translation catalogs.
- The package is framework-agnostic. Callers resolve request locale and pass `locale` into the renderer.
- The package uses `use-intl` core for translation. Do not add request, cookie, or header parsing here.

## Translation Rules

- `src/locales/en.json` is the source-of-truth catalog.
- Every locale file under `src/locales/*.json` must have the exact same key paths as `src/locales/en.json`.
- No per-key runtime English fallback is allowed inside the package. Missing translations must be fixed in the locale files.
- If a key is added, removed, renamed, or moved in `src/locales/en.json`, apply the same path change to every locale file in the same change.
- If a translated value is not available yet, temporarily copy the English string so the key exists in every locale file.

## Verification

- Keep the locale-shape test in `src/i18n/translate.test.ts` passing.
- Before finishing translation changes, verify there are no missing or extra locale keys.

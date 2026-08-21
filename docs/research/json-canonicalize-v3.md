# json-canonicalize: 2.0.0 → 3.x upgrade research

**Date:** 2026-08-21  
**Scope:** Whether Sokosumi (`packages/masumi` pins `2.0.0`) can/should move to latest 3.x.  
**Sources:** npm registry + published tarballs, GitHub `snowyu/json-canonicalize.ts` (changelog, tags, source at tags, issues). No secondary blogs.

## Summary

- Latest 3.x is **`3.0.0`**, published **2026-08-20T13:42:02.884Z**. Pin exact string **`3.0.0`**.
- Declared 3.0.0 break is **packaging/build** (dual ESM/CJS via tsup, `exports` map). Public API names `canonicalize` / `canonicalizeEx` / `ISerializeOptions` still export.
- **`object.toJSON != null` → `JSON.stringify` short-circuit is STILL PRESENT in v3.** Insertion-order, unsorted. Does **not** fix the x402 payment-required equality hole that forced the local `payment-required.canonical.ts` fork.
- `canonicalizeEx` + `{ filterUndefined: true }` still exist; semantics unchanged vs 2.0.0 for that option.
- For ordinary JSON (no `toJSON`, no `undefined`, finite numbers, plain objects/arrays): **v3 bytes match v2.0.0** (empirically checked on both published tarballs).
- Real behavior delta vs **2.0.0**: non-finite numbers (`NaN`/`Infinity`) **throw** in 3.0.0 (fix landed in 2.0.1). That is better for Sokosumi’s `hashCanonicalJsonValue` (catch → `null`) than 2.0.0’s collide-to-`null` serialization.
- Upgrade of the dep for `hash.ts` is plausible; it does **not** let you delete the local 402 canonicalizer.

---

## 1. Latest 3.x version / publish date / pin string

| Fact | Value | Citation |
| --- | --- | --- |
| `dist-tags.latest` | `3.0.0` | https://registry.npmjs.org/json-canonicalize → `"dist-tags":{"latest":"3.0.0"}` |
| Only 3.x on registry | `3.0.0` | same document, `versions` keys end at `3.0.0` |
| Publish time | `2026-08-20T13:42:02.884Z` | same document, `"time"."3.0.0"` |
| Pin string | **`3.0.0`** | exact version (Sokosumi pinned-deps rule) |
| npm page | package exists, latest 3.0.0 | https://www.npmjs.com/package/json-canonicalize |
| Integrity (npm) | `sha512-PW21BtLiKRV7gJcT8jf2X4UNN2AF4c1TYEVug1wAWRQSGBJj7fL+v4NgOkIo54SCBPFDyqzMcOJNhjwywCIBuw==` | registry `versions["3.0.0"].dist.integrity` |

Related prior publishes (same `time` map):

- `2.0.0` → `2025-06-29T06:03:05.845Z`
- `2.0.1` → `2026-08-14T07:42:55.778Z` (broken publish; see §2 / issue #25)

---

## 2. Breaking changes 2.0.0 → 3.x

### Changelog (authoritative)

From https://raw.githubusercontent.com/snowyu/json-canonicalize.ts/master/CHANGELOG.md (also at tag `v3.0.0`):

```text
## [3.0.0] (2026-08-20)
### ⚠ BREAKING CHANGES
* modernize build system, add dual ESM/CJS support, fix #25

### Features
* modernize build system, add dual ESM/CJS support, fix #25 (b6679e2)
```

Compare range on GitHub (`v2.0.0...v3.0.0`): 5 commits — README circular docs, **non-finite throw** (`a1a5328`, released as 2.0.1), then build modernization + `3.0.0` release.  
API: https://api.github.com/repos/snowyu/json-canonicalize.ts/compare/v2.0.0...v3.0.0

### Packaging / module shape

| | 2.0.0 tarball | 3.0.0 tarball |
| --- | --- | --- |
| Entry | `main`: `./bundles/index.umd.js`, `module`: `./esm5/index.js`, `typings`: `./types/index.d.ts` | `main`/`module`/`types` under `./dist/…`, plus conditional `exports` |
| Shipped files | `src`, `bundles`, `esm5`, `esm2015`, `types` | **`dist` only** (`"files":["dist"]`) |
| Exports | `canonicalize`, `canonicalizeEx` | same + type export `ISerializeOptions` from package root |

Sources: published `package.json` inside `json-canonicalize-2.0.0.tgz` / `json-canonicalize-3.0.0.tgz` from registry.

**Issue #25** (closed): *“json-canonicalize 2.0.1 published src only”* — install of 2.0.1 broke imports because only `src` was packaged. 3.0.0’s stated break is fixing that via tsup dual publish.  
https://github.com/snowyu/json-canonicalize.ts/issues/25

### API surface

- Still: `canonicalize(obj, allowCircular?)`, `canonicalizeEx(obj, options?)`.
- Options interface unchanged in shape: `allowCircular`, `include`, `exclude`, `filterUndefined`, `undefinedInArrayToNull` (v3 `dist/index.d.ts` and v2 `src` / types).
- Doc/default claim for `canonicalizeEx` still says `filterUndefined` / `undefinedInArrayToNull` “Defaults to `true`”, but **code does not apply those defaults inside `canonicalizeEx`** — only `canonicalize()` hardcodes them. Same in 2.0.0 and 3.0.0 source. Callers that omit options get falsy flags. Sokosumi always passes `{ filterUndefined: true }` explicitly.

### Doc path that breaks in v3

README still shows `import from 'json-canonicalize/src/global'`. v3 tarball has no `src/`; resolving that subpath fails (`MODULE_NOT_FOUND`). Sokosumi does not use it.

### Behavioral break vs 2.0.0 (not listed under 3.0.0 BREAKING, but real)

Landed in **2.0.1** / commit `a1a5328`, present in **3.0.0**:

- 2.0.0: `NaN` / `Infinity` → serialized as JSON `null` (via `JSON.stringify`).
- 3.0.0: throws `Non-finite number (…) is not permitted in JSON (RFC 8785 §3.2.2.3)`.

Issue #24 documents the 2.0.0 bug and the RFC MUST.  
https://github.com/snowyu/json-canonicalize.ts/issues/24

---

## 3. Does v3 still short-circuit on `object.toJSON != null`?

**Yes. Unchanged.**

v2.0.0 published source (`src/serializer.ts`):

```ts
if (
  object === null ||
  typeof object !== 'object' ||
  object.toJSON != null
) {
  buffer += JSON.stringify(object);
}
```

v3.0.0 tag source (`src/serializer.ts` at ref `v3.0.0`) and published `dist/index.js` / `dist/index.mjs`:

```ts
if (object === null || typeof object !== "object" || object.toJSON != null) {
  // … non-finite number check added …
  buffer += JSON.stringify(object);
}
```

The only serializer logic delta `v2.0.0...v3.0.0` is the non-finite throw **inside that same branch** (GitHub compare patch on `src/serializer.ts`).

Empirical (both tarballs):

- `{ toJSON() { return { z: 9, y: 8 }; } }` → `'{"z":9,"y":8}'` (toJSON result, **unsorted**).
- `{ b: 1, a: 2, toJSON: "x" }` → `'{"b":1,"a":2,"toJSON":"x"}'` — proves insertion order (b before a). Matches Sokosumi’s local-fork rationale.

**Implication:** upgrading does **not** retire `/packages/masumi/src/schemas/x402/payment-required.canonical.ts`.

---

## 4. `canonicalizeEx` and `{ filterUndefined: true }`

| Question | Answer | Evidence |
| --- | --- | --- |
| Still exported? | Yes | v3 `dist/index.d.ts`: `export { … canonicalize, canonicalizeEx }` |
| Option name same? | Yes `filterUndefined?: boolean` | same d.ts / `ISerializeOptions` |
| Semantics | If `true`, object keys whose value is `undefined` are omitted before sort; if falsy/absent, keys kept (and nested serialize of `undefined` still goes through the primitive/`JSON.stringify` path) | `_serialize` in both versions: `if (filterUndefined) { vKeys = vKeys.filter((k) => object[k] !== undefined); }` |
| Defaults on `canonicalizeEx` | **Not applied in code**; README claim of default `true` is misleading for bare `canonicalizeEx(obj)` | `canonicalizeEx` → `_serialize(obj, options)` with no merging; only `canonicalize()` sets `filterUndefined: true` |

Sokosumi usage is explicit and therefore stable across 2.0.0 and 3.0.0:

```ts
canonicalizeEx(value, { filterUndefined: true });
```

---

## 5. Identical canonical bytes for ordinary JSON?

**Yes for ordinary cases** (no `toJSON`, no `undefined`, finite numbers, plain objects/arrays), comparing published 2.0.0 UMD vs 3.0.0 CJS:

| Input | Result |
| --- | --- |
| `{ b: 2, a: 1 }` | IDENTICAL `{"a":1,"b":2}` |
| nested object + array + null | IDENTICAL |
| insertion-order keys without `toJSON` | IDENTICAL (both sort) |
| `{ filterUndefined: true }` with `undefined` props | IDENTICAL |
| array `undefined` + `undefinedInArrayToNull: true/false` | IDENTICAL (both versions) |
| `Date` (builtin `toJSON`) | IDENTICAL (both short-circuit via stringify) |

**Differs from 2.0.0 when:**

- non-finite number: 2.0.0 → `{"v":null}`; 3.0.0 → **throws**.

No other serializer differences found in the tagged source diff.

---

## 6. RFC 8785 notes (`undefinedInArrayToNull`, etc.)

From v3 README (also registry package `readme`):

- Claims JCS / RFC 8785 compatibility with differences:
  - Default `canonicalize`: `undefined` in arrays → `null`; RFC treats as `undefined` (different output). Fix: `canonicalizeEx(obj, { undefinedInArrayToNull: false })`.
  - Recursive / circular references supported as an extension.
- Non-finite numbers: README says both `canonicalize` and `canonicalizeEx` **throw** (matches 3.0.0 / 2.0.1 code; **not** 2.0.0 behavior).
- Links: https://www.rfc-editor.org/rfc/rfc8785

**Not documented in README:** the `toJSON` short-circuit (deviation from “sort all object properties” for any object that happens to own a non-null `toJSON`).

`undefinedInArrayToNull` option still exists with the same meaning in v3 types/source.

---

## 7. License, maintainer, repo health

| Item | Value | Citation |
| --- | --- | --- |
| License | **MIT** | registry metadata; `LICENSE.md` in tarball (“Copyright (c) 2018 Riceball LEE”) |
| Author / maintainer | Riceball LEE `<snowyu.lee@gmail.com>` / npm user `riceball` | registry `author` / `maintainers` |
| Repo | https://github.com/snowyu/json-canonicalize.ts | registry `repository.url` (older 1.0.x pointed at `json-canonicalize` without `.ts`) |
| Stars / forks | 9 stars, 1 fork (as of fetch) | GitHub API `repos/snowyu/json-canonicalize.ts` |
| Archived? | no | same |
| Last push | 2026-08-20 (3.0.0 release) | `pushed_at` |
| Open issues | 8; all inspected titles are Dependabot bumps (#12–#20), not product bugs | GitHub issues API |
| Releases (GitHub Releases UI) | empty list | `GET /repos/…/releases` → `[]` (tags exist: `v3.0.0`, `v2.0.1`, `v2.0.0`, …) |
| npm traffic | ~786k downloads last month; ~154k last week | https://api.npmjs.org/downloads/point/last-month/json-canonicalize |
| Build badge | README still points at Travis `snowyu/json-canonicalize` (old name) | cosmetic staleness |

**Health take:** single maintainer, small star count, but actively shipping (2.0.1 + 3.0.0 within a week of this research). 2.0.1 was a bad publish; 3.0.0 is the recovery. No GitHub Release objects—tags + npm only.

---

## 8. Alternatives (brief; v3 not “unusable” for hash path)

v3 remains usable for Sokosumi’s **hash** path (byte-stable for ordinary JSON; stricter non-finite handling). It does **not** fix the **402 equality** `toJSON` bug—keep the local fork.

If replacing the dependency entirely were required:

- **`canonicalize`** (often cited as reference JCS; issue #24 notes `canonicalize@4.0.0` throws on `1e400`) — different API; would need hash interop proof against payment-node expectations.
- **`canonical-json`** / others — not evaluated here beyond noting they exist; any swap must preserve digests the Masumi payment node already computes.

Prefer: pin `3.0.0` for `hash.ts` if desired; **do not** route attacker-authored 402 equality through this package until `toJSON` short-circuit is removed upstream.

---

## Sokosumi call sites (this repo)

Pinned at research time: `2.0.0`. After this upgrade: [`packages/masumi/package.json`](../../packages/masumi/package.json) → `"json-canonicalize": "3.0.0"`.

### Direct dependency usage

| Path | Role |
| --- | --- |
| [`packages/masumi/src/hash/hash.ts`](../../packages/masumi/src/hash/hash.ts) | **Only import of the package.** `canonicalizeEx(…, { filterUndefined: true })` inside `hashCanonicalJsonValue` and `_hashInput`. Failures catch → `null`. |
| [`packages/masumi/src/hash/index.ts`](../../packages/masumi/src/hash/index.ts) | Re-exports `hashCanonicalJsonValue`. |
| [`packages/masumi/src/hash/__tests__/hash.test.ts`](../../packages/masumi/src/hash/__tests__/hash.test.ts) | Tests `hashCanonicalJsonValue` key-order stability. |
| [`packages/masumi/src/clients/agent.client.ts`](../../packages/masumi/src/clients/agent.client.ts) | Calls `hashCanonicalJsonValue` on status body. |
| [`packages/masumi/src/clients/__tests__/agent.client.test.ts`](../../packages/masumi/src/clients/__tests__/agent.client.test.ts) | Asserts hashes via `hashCanonicalJsonValue`. |

### Local fork (avoids `toJSON` bug; does **not** import the package)

| Path | Role |
| --- | --- |
| [`packages/masumi/src/schemas/x402/payment-required.canonical.ts`](../../packages/masumi/src/schemas/x402/payment-required.canonical.ts) | Local RFC-8785-style serializer for 402 value equality. Comments document why `json-canonicalize` is unsafe here (`toJSON != null` → unsorted `JSON.stringify`). |
| [`packages/masumi/src/schemas/x402/__tests__/payment-required.canonical.test.ts`](../../packages/masumi/src/schemas/x402/__tests__/payment-required.canonical.test.ts) | Regression: `toJSON: "x"` must still sort keys. |

Other grep hits for the word “canonicaliz*” are domain wording (CAIP / readiness / schema), not this npm package.

---

## Recommendation (for implementers)

1. Safe to bump `packages/masumi` pin **`2.0.0` → `3.0.0`** for hash interop on ordinary JSON; expect `hashCanonicalJsonValue(Infinity|NaN-bearing)` to return `null` instead of hashing a `null`-substituted document (stricter, fail-closed).
2. Keep `payment-required.canonical.ts`; v3 does not fix the security/correctness bug.
3. Avoid `2.0.1` (broken tarball per #25).
4. Re-run `pnpm masumi:test` (esp. hash + agent client + payment-required.canonical tests) after the pin bump.

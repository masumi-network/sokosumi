# DataTable createTableHook Typing Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind all Sokosumi `DataTable` consumers to a module-scope `createTableHook` factory so column helpers and hub types share `DataTableFeatures`, eliminate per-column `as ColumnDef` casts and hub `any`, and preserve runtime table behavior after #3728.

**Architecture:** Keep `dataTableFeatures` as the single feature registry. Add `create-data-table-hook.ts` that calls `createTableHook({ features: dataTableFeatures })` at module scope and exports `useAppTable` + `createAppColumnHelper`. `DataTable` switches from `useTable` to `useAppTable` with the same per-call options. Every column factory uses `createAppColumnHelper` + `.columns([...])` (or cast-free named pieces with at most one assembly-boundary assertion). No AppTable/AppCell markup rewrite.

**Tech Stack:** `@tanstack/react-table` 9.1.2, Next.js App Router web app (`apps/web`), Vitest + Testing Library, TypeScript, Biome.

**Spec:** `docs/superpowers/specs/2026-08-10-data-table-create-table-hook-design.md`

## Global Constraints

- Exact pin remains `@tanstack/react-table` `9.1.2` (no range, no version bump required)
- Factory must be **module scope only** — never create inside a React render
- Do **not** register `tableComponents` / `cellComponents` / `headerComponents` on the factory this PR (HMR / circular import risk)
- Preserve runtime: `manualPagination: !showPagination`, `manualSorting` passthrough, `enableRowRangeSelection: false`, sort registry, grouping
- One PR migrates **all** `DataTable` column consumers
- Conventional commits; draft PR title: `refactor(web): type DataTable via createTableHook`
- Prefer `function` keyword for pure helpers; two-space Biome style

## File map

| Path | Responsibility |
|------|----------------|
| `apps/web/src/components/data-table/create-data-table-hook.ts` | **Create** — `createTableHook` factory exports |
| `apps/web/src/components/data-table/data-table.tsx` | **Modify** — `useAppTable`; columns type without `any` |
| `apps/web/src/components/data-table/index.ts` | **Modify** — re-export factory helpers |
| `apps/web/src/components/data-table/data-table-column-header.tsx` | **Modify only if** types need factory `Column` |
| `apps/web/src/components/data-table/data-table-pagination.tsx` | Unchanged unless type import path changes |
| `apps/web/src/components/data-table/data-table-features.ts` | Unchanged (features source of truth) |
| `apps/web/src/components/data-table/__tests__/data-table-features.test.ts` | **Modify** — use factory helper if needed |
| `apps/web/src/components/data-table/__tests__/create-data-table-hook.test.ts` | **Create** — factory + helper smoke tests |
| `apps/web/src/components/admin/agents/agent-list-columns.tsx` | Migrate |
| `apps/web/src/components/admin/coworkers/coworkers-table-columns.tsx` | Migrate |
| `apps/web/src/components/admin/vendors/vendors-table-columns.tsx` | Migrate |
| `apps/web/src/components/admin/enterprise-contracts/contracts-table.tsx` | Migrate inline columns |
| `apps/web/src/app/(app)/developer/components/api-keys/api-keys-columns.tsx` | Migrate |
| `apps/web/src/app/(app)/agents/[agentId]/jobs/components/job-columns.tsx` | Migrate object map |
| `apps/web/src/components/members-table/members-table-columns.tsx` | Migrate object map |

---

### Task 1: Factory module + smoke tests (TDD)

**Files:**
- Create: `apps/web/src/components/data-table/create-data-table-hook.ts`
- Create: `apps/web/src/components/data-table/__tests__/create-data-table-hook.test.ts`
- Modify: `apps/web/src/components/data-table/index.ts`

**Interfaces:**
- Consumes: `dataTableFeatures` from `./data-table-features`
- Produces:
  - `useAppTable` — bound table hook (features pre-applied)
  - `createAppColumnHelper` — `createAppColumnHelper<TData extends RowData>()`
  - optional: re-export types as needed

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/data-table/__tests__/create-data-table-hook.test.ts`:

```ts
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  createAppColumnHelper,
  useAppTable,
} from "../create-data-table-hook";

interface Row {
  id: string;
  name: string;
}

describe("create-data-table-hook", () => {
  it("useAppTable sorts without passing features", () => {
    const helper = createAppColumnHelper<Row>();
    const columns = helper.columns([
      helper.accessor("name", { id: "name" }),
    ]);

    const { result } = renderHook(() =>
      useAppTable({
        columns,
        data: [
          { id: "2", name: "bob" },
          { id: "1", name: "alice" },
        ],
        initialState: {
          pagination: { pageIndex: 0, pageSize: 50 },
          sorting: [{ id: "name", desc: false }],
        },
      }),
    );

    expect(
      result.current.getRowModel().rows.map((row) => row.original.name),
    ).toEqual(["alice", "bob"]);
  });

  it("createAppColumnHelper columns() needs no cast to pass into useAppTable", () => {
    const helper = createAppColumnHelper<Row>();
    const columns = helper.columns([
      helper.accessor("name", { id: "name" }),
      helper.display({ id: "actions", cell: () => null }),
    ]);

    const { result } = renderHook(() =>
      useAppTable({
        columns,
        data: [{ id: "1", name: "alice" }],
        initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
      }),
    );

    expect(result.current.getAllColumns().map((c) => c.id)).toEqual([
      "name",
      "actions",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter web test src/components/data-table/__tests__/create-data-table-hook.test.ts
```

Expected: FAIL — cannot resolve `../create-data-table-hook` or exports missing.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/components/data-table/create-data-table-hook.ts`:

```ts
import { createTableHook } from "@tanstack/react-table";

import { dataTableFeatures } from "./data-table-features";

/**
 * App-wide DataTable factory. Module scope only.
 * Features are bound; pass columns/data/state per table.
 */
export const {
  useAppTable,
  createAppColumnHelper,
} = createTableHook({
  features: dataTableFeatures,
});
```

Update `apps/web/src/components/data-table/index.ts` to export:

```ts
export {
  createAppColumnHelper,
  useAppTable,
} from "./create-data-table-hook";
```

(keep existing DataTable / features / pagination exports)

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter web test src/components/data-table/__tests__/create-data-table-hook.test.ts
pnpm --filter web test src/components/data-table/__tests__/data-table-features.test.ts
```

Expected: PASS both files.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/data-table/create-data-table-hook.ts \
  apps/web/src/components/data-table/__tests__/create-data-table-hook.test.ts \
  apps/web/src/components/data-table/index.ts
git commit -m "feat(web): add DataTable createTableHook factory"
```

---

### Task 2: Wire DataTable hub to useAppTable; kill hub `any`

**Files:**
- Modify: `apps/web/src/components/data-table/data-table.tsx`
- Test: existing + Task 1 tests (no new UI test required)

**Interfaces:**
- Consumes: `useAppTable` from `./create-data-table-hook`
- Produces: `DataTable` still accepts `columns` + `data`; column type uses `unknown` not `any`

- [ ] **Step 1: Write a failing type-level expectation (document via test import)**

In `create-data-table-hook.test.ts`, add a test that mirrors hub usage shape:

```ts
it("accepts mixed-value columns array from columns() into useAppTable", () => {
  const helper = createAppColumnHelper<{ id: string; n: number; s: string }>();
  const columns = helper.columns([
    helper.accessor("s", { id: "s" }),
    helper.accessor("n", { id: "n" }),
  ]);
  const { result } = renderHook(() =>
    useAppTable({
      columns,
      data: [{ id: "1", n: 2, s: "a" }],
      initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
    }),
  );
  expect(result.current.getRowModel().rows).toHaveLength(1);
});
```

Run that test (should still pass once factory exists). This locks the columns() → useAppTable path before hub change.

- [ ] **Step 2: Change DataTable implementation**

In `data-table.tsx`:

1. Replace `useTable` import with `useAppTable` from `./create-data-table-hook`
2. Remove `dataTableFeatures` import usage from the hook call (features come from factory)
3. Change props:

```ts
columns: ColumnDef<DataTableFeatures, TData, unknown>[];
```

4. Replace hook call:

```ts
const table = useAppTable({
  data,
  columns,
  state: {
    sorting,
    columnVisibility,
    rowSelection,
    columnFilters,
  },
  initialState: {
    pagination: {
      pageIndex: 0,
      pageSize: initialPageSize ?? 10,
    },
  },
  enableRowSelection,
  enableRowRangeSelection: false,
  onRowSelectionChange: setRowSelection,
  manualPagination: !showPagination,
  manualSorting,
  onSortingChange: setSorting,
  onColumnFiltersChange: setColumnFilters,
  onColumnVisibilityChange: setColumnVisibility,
});
```

Keep `"use no memo"` and eslint incompatible-library comment; update comment text from `useReactTable`/`useTable` to `useAppTable` if needed.

If `columns: ColumnDef<…, unknown>[]` fails typecheck against `columns()` return (`any` element type from tanstack), use:

```ts
columns: ColumnDef<DataTableFeatures, TData, any>[]; // only if unknown fails — prefer unknown first
```

Spec prefers **not** `any`. If only `any` works at hub, stop and use a named alias:

```ts
/** Mixed cell TValues; prefer createAppColumnHelper().columns() at call sites. */
export type DataTableColumns<TData extends RowData> = ColumnDef<
  DataTableFeatures,
  TData,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mixed column TValue
  any
>[];
```

Only after proving `unknown` fails typecheck with a real consumer.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web typecheck
```

Expected: may fail on consumers still using old helper shapes until Tasks 3–4 — hub alone should typecheck if consumers still cast. Fix only hub errors here.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/data-table/data-table.tsx \
  apps/web/src/components/data-table/__tests__/create-data-table-hook.test.ts
git commit -m "refactor(web): DataTable uses useAppTable without feature prop"
```

---

### Task 3: Migrate array-style column factories

**Files:**
- Modify: `apps/web/src/components/admin/agents/agent-list-columns.tsx`
- Modify: `apps/web/src/components/admin/coworkers/coworkers-table-columns.tsx`
- Modify: `apps/web/src/components/admin/vendors/vendors-table-columns.tsx`
- Modify: `apps/web/src/components/admin/enterprise-contracts/contracts-table.tsx`
- Modify: `apps/web/src/app/(app)/developer/components/api-keys/api-keys-columns.tsx`

**Interfaces:**
- Consumes: `createAppColumnHelper` from `@/components/data-table`
- Produces: `getXColumns(...):` return type compatible with `DataTable` columns prop; **no** `as ColumnDef`

- [ ] **Step 1: Pattern for each file (apply to all five)**

Before:

```ts
import { type ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { DataTableColumnHeader, type DataTableFeatures } from "@/components/data-table";

const columnHelper = createColumnHelper<DataTableFeatures, Row>();

export function getXColumns(...): ColumnDef<DataTableFeatures, Row>[] {
  return [
    columnHelper.accessor("name", { ... }) as ColumnDef<DataTableFeatures, Row>,
    // ...
  ];
}
```

After:

```ts
import {
  createAppColumnHelper,
  DataTableColumnHeader,
} from "@/components/data-table";

const columnHelper = createAppColumnHelper<Row>();

export function getXColumns(...) {
  return columnHelper.columns([
    columnHelper.accessor("name", { ... }),
    // ... no casts
  ]);
}
```

Remove unused `ColumnDef` / `DataTableFeatures` imports when no longer needed.

**contracts-table.tsx:** columns are defined inline in the same file — same pattern around `createColumnHelper` / casts.

- [ ] **Step 2: Typecheck after each file or batch**

```bash
pnpm --filter web typecheck
```

Fix until green for these modules.

- [ ] **Step 3: Grep gate (partial)**

```bash
rg "as ColumnDef" apps/web/src/components/admin apps/web/src/app/\(app\)/developer --glob "*.{ts,tsx}"
```

Expected: no matches under those paths.

- [ ] **Step 4: Commit**

```bash
git add \
  apps/web/src/components/admin/agents/agent-list-columns.tsx \
  apps/web/src/components/admin/coworkers/coworkers-table-columns.tsx \
  apps/web/src/components/admin/vendors/vendors-table-columns.tsx \
  apps/web/src/components/admin/enterprise-contracts/contracts-table.tsx \
  apps/web/src/app/\(app\)/developer/components/api-keys/api-keys-columns.tsx
git commit -m "refactor(web): cast-free app column helpers for admin/api-keys tables"
```

---

### Task 4: Migrate jobs + members object-map column factories

**Files:**
- Modify: `apps/web/src/app/(app)/agents/[agentId]/jobs/components/job-columns.tsx`
- Modify: `apps/web/src/components/members-table/members-table-columns.tsx`
- Possibly touch assemblers: `jobs-table.tsx`, `members-table.tsx` if return types break

**Interfaces:**
- Keep named column properties for conditional assembly
- No per-column `as ColumnDef`
- At most **one** cast at assembly return if TS requires

- [ ] **Step 1: job-columns.tsx**

```ts
import { createAppColumnHelper, DataTableColumnHeader } from "@/components/data-table";

const columnHelper = createAppColumnHelper<JobSummary>();

export function getJobColumns(...) {
  return {
    createdAtColumn: columnHelper.accessor("createdAt", {
      // keep sortFn: "datetime"
      ...
    }),
    statusColumn: columnHelper.accessor("status", { ... }),
    nameColumn: columnHelper.accessor("name", { ... }),
  };
}
```

In `jobs-table.tsx` `getColumns`, assemble with:

```ts
return columnHelper.columns([createdAtColumn, statusColumn, nameColumn]);
```

If `columnHelper` is not in scope in `jobs-table.tsx`, either export a small `buildJobColumnsArray(...)` from `job-columns.tsx` that returns `columnHelper.columns([...])`, or assemble array and pass to DataTable — prefer **builder in job-columns.tsx**:

```ts
export function getJobTableColumns(...args) {
  const { createdAtColumn, statusColumn, nameColumn } = getJobColumns(...args);
  return columnHelper.columns([createdAtColumn, statusColumn, nameColumn]);
}
```

Update `jobs-table.tsx` to call the builder if simpler.

- [ ] **Step 2: members-table-columns.tsx**

Same approach: `createAppColumnHelper<MemberRowData>()`, drop casts, export either named map + assembler:

```ts
export function getMembersTableColumnList(
  t: ...,
  me: ...,
  options: { showSeatManagement: boolean; includeActions: boolean },
) {
  const cols = getMembersTableColumns(t, me);
  const list = [cols.nameColumn, cols.emailColumn, cols.roleColumn, cols.lastSeenColumn];
  if (options.showSeatManagement) list.push(cols.seatColumn);
  if (options.includeActions) list.push(cols.actionColumn);
  return columnHelper.columns(list as [typeof cols.nameColumn, ...typeof list]);
}
```

If tuple cast is ugly, simpler path that still meets "one boundary":

```ts
return columnHelper.columns([
  cols.nameColumn,
  cols.emailColumn,
  cols.roleColumn,
  cols.lastSeenColumn,
  ...(options.showSeatManagement ? [cols.seatColumn] : []),
  ...(options.includeActions ? [cols.actionColumn] : []),
]);
```

If spread breaks `columns()` typing, build full array then:

```ts
return columnHelper.columns(selected as [
  (typeof selected)[0],
  ...(typeof selected),
]);
```

**Last resort (spec-allowed):** single `as ColumnDef<DataTableFeatures, MemberRowData, unknown>[]` on the **return of the assembler only**, never on each accessor.

Update `members-table.tsx` `getColumns` to use the new builder if introduced.

- [ ] **Step 3: Typecheck + tests**

```bash
pnpm --filter web typecheck
pnpm --filter web test src/components/data-table
```

Expected: PASS.

- [ ] **Step 4: Grep gate (full)**

```bash
rg "as ColumnDef" apps/web/src --glob "*.{ts,tsx}"
rg "createColumnHelper<" apps/web/src --glob "*.{ts,tsx}"
```

Expected:
- No `as ColumnDef` (except possibly one documented assembly line — prefer zero)
- No bare `createColumnHelper<` outside `node_modules` (tests may use factory only)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(app\)/agents/\[agentId\]/jobs/components/ \
  apps/web/src/components/members-table/
git commit -m "refactor(web): cast-free job and members table columns"
```

---

### Task 5: Align sort unit test + final verification + PR

**Files:**
- Modify if needed: `apps/web/src/components/data-table/__tests__/data-table-features.test.ts` (prefer `createAppColumnHelper` for consistency)
- Docs: PR body only

- [ ] **Step 1: Update data-table-features.test.ts to use factory**

Replace:

```ts
createColumnHelper<DataTableFeatures, SortRow>()
```

with:

```ts
createAppColumnHelper<SortRow>()
```

and `useAppTable` instead of `useTable` if the test constructs a table — keeps one path.

- [ ] **Step 2: Full web verify**

```bash
pnpm --filter web typecheck
pnpm --filter web test
pnpm exec biome check apps/web/src/components/data-table apps/web/src/components/members-table apps/web/src/components/admin \
  "apps/web/src/app/(app)/agents/[agentId]/jobs" \
  "apps/web/src/app/(app)/developer/components/api-keys"
```

Expected: all green.

- [ ] **Step 3: Commit + push + draft PR**

```bash
git add -A
git status
git commit -m "test(web): route data-table sort tests through createTableHook factory" || true

git push -u origin HEAD

gh pr create --draft --title "refactor(web): type DataTable via createTableHook" --body "$(cat <<'EOF'
## Summary

Follow-up to #3728. Introduces app-wide `createTableHook` factory for DataTables so features, column helpers, and hub types share one binding.

- `createAppColumnHelper` / `useAppTable` (module-scope factory)
- Cast-free column modules via `columnHelper.columns([...])`
- Hub no longer uses `any` for mixed cell values (or documents single alias if TS forces)
- Runtime behavior unchanged (pagination, manualSorting, range selection off)

Spec: `docs/superpowers/specs/2026-08-10-data-table-create-table-hook-design.md`

## Test plan

- [x] `pnpm --filter web typecheck`
- [x] `pnpm --filter web test`
- [x] data-table unit tests (features + factory)
- [ ] Spot-check members (pagination), vendors/coworkers (no pagination), admin agents (`manualSorting`)

EOF
)"
```

---

## Spec coverage checklist (plan self-review)

| Spec requirement | Task |
|------------------|------|
| `createTableHook` factory module scope | Task 1 |
| `useAppTable` inside DataTable | Task 2 |
| No hub `any` (prefer unknown) | Task 2 |
| All column consumers one PR | Tasks 3–4 |
| Zero per-column `as ColumnDef` | Tasks 3–4 grep |
| Jobs/members named assembly | Task 4 |
| Sort registry preserved | Task 1/5 + existing tests |
| No App* markup | All tasks non-goal |
| Typecheck + web tests | Task 5 |
| Draft conventional PR | Task 5 |

**Placeholder scan:** none intentional.  
**Type names:** `useAppTable`, `createAppColumnHelper`, `dataTableFeatures`, `DataTableFeatures` consistent across tasks.

# Design: DataTable `createTableHook` typing cleanup

**Date:** 2026-08-10  
**Status:** Approved (conversation)  
**PR target:** follow-up to #3728 (`@tanstack/react-table` v9)  
**Approach:** B — factory is public API; `DataTable` remains layout shell  

## Goal

Make shared table types agent-clear and cast-free:

- One feature-bound factory (`createTableHook`) owns `DataTableFeatures`
- Column helpers cannot drift from hub features
- No `as ColumnDef<…>` spray; no hub `columns: … any[]`
- Preserve runtime behavior (pagination, manual sorting, selection, grouping)

## Non-goals

- Rewrite table markup to `<table.AppTable>` / AppCell / AppHeader registries
- Nested scoped table contexts
- Multiple feature factories
- Product/UI changes

## Success criteria

1. Zero `as ColumnDef` in `apps/web` table column modules
2. Hub column prop does not use `any` (prefer `unknown` or factory-inferred column type)
3. All current `DataTable` consumers migrate in **one PR**
4. Existing sort registry unit tests still pass; add a type-level or compile test that wrong-feature helper is not possible (if practical without heavy tooling)
5. `pnpm --filter web typecheck` and `pnpm --filter web test` green
6. Manual behavior parity: paginated members, non-paginated admin table, agent list `manualSorting`

## Architecture

### Module layout

```
apps/web/src/components/data-table/
  data-table-features.ts      # existing tableFeatures + sort/filter registries
  create-data-table-hook.ts   # NEW: createTableHook({ features: dataTableFeatures, … })
  data-table.tsx              # layout shell; useAppTable internally OR accept table
  data-table-column-header.tsx
  data-table-pagination.tsx
  index.ts                    # export factory helpers + DataTable
```

**Factory (module scope only — never inside render):**

```ts
export const {
  useAppTable,
  createAppColumnHelper,
  useTableContext, // export only if a consumer needs it this PR
} = createTableHook({
  features: dataTableFeatures,
  // defaults that match current DataTable behavior where stable
});
```

Bind defaults carefully: only options that are true for every table (e.g. not `manualSorting`). Per-table options stay on each `useAppTable` / `DataTable` call.

### Public API

**Column modules**

```ts
const columnHelper = createAppColumnHelper<RowType>();

export function getXColumns(...): DataTableColumnDef<RowType>[] {
  return columnHelper.columns([
    columnHelper.accessor("…", { … }),
    columnHelper.display({ … }),
  ]);
}
```

Export a thin alias if useful:

```ts
type DataTableColumnDef<TData extends RowData> = ColumnDef<
  DataTableFeatures,
  TData,
  unknown
>;
// Prefer factory-inferred return of columns() over hand-written aliases when possible.
```

**Jobs / members (named columns)**

Keep named building blocks if call sites need conditional assembly, but each piece is produced without casts. Prefer:

```ts
const helper = createAppColumnHelper<MemberRowData>();
const nameColumn = helper.accessor(…); // no cast
// assemble: helper.columns([...selected]) OR typed array with unknown TValue
```

If named exports cannot form a homogeneous array without a single boundary assertion, allow **one** assertion at the assembly function return — not per-column.

**`DataTable`**

Keep primary API for one-PR churn:

```tsx
<DataTable columns={…} data={…} …props />
```

Internally: `useAppTable({ …options, columns, data })` instead of raw `useTable`.

Optional advanced prop for later (YAGNI unless needed mid-implementation):

```tsx
table?: ReactTable<DataTableFeatures, TData>
```

Do not require all call sites to construct tables themselves in this PR.

### Typing rules

| Layer | Rule |
|-------|------|
| Features | Single `dataTableFeatures` object; factory binds it |
| Column helper | Only `createAppColumnHelper` (not bare `createColumnHelper` with hand-passed features) |
| Hub columns | `ColumnDef<DataTableFeatures, TData, unknown>[]` or factory column type — **not** `any` |
| Casts | Forbidden per-column; single assembly boundary only if TS requires |
| Pagination / header | Types from `DataTableFeatures` / `ReactTable` as today |

### Import graph / HMR

- Factory module must not import consumer column modules
- Do not register React components on the factory this PR (avoids circular HMR issues)
- Column modules import factory from `@/components/data-table` or relative `create-data-table-hook`

### Runtime behavior (must preserve)

From #3728:

- `manualPagination: !showPagination`
- `manualSorting` passthrough
- `enableRowRangeSelection: false`
- Controlled / internal sorting state
- Optional grouping rows
- Sort registry (auto + datetime + full built-ins)

## Migration plan (single PR)

1. Add `create-data-table-hook.ts`; re-export from `index.ts`
2. Switch `DataTable` to `useAppTable`
3. Migrate column modules: array factories first (agents, coworkers, vendors, contracts, api-keys), then jobs/members object maps
4. Grep-gate: no `as ColumnDef`, no bare `createColumnHelper` under table paths (except tests if needed)
5. Typecheck + web tests + sort unit tests
6. Draft PR conventional title e.g. `refactor(web): type DataTable via createTableHook`

## Testing

- Keep `data-table-features.test.ts` (sort registry)
- Add test (or typecheck-only assert) that `useAppTable` + `createAppColumnHelper` share features — e.g. smoke renderHook sorting still works through factory if construction path differs
- No visual regression suite required; manual checklist in PR body

## Risks

| Risk | Mitigation |
|------|------------|
| TS variance still forces a cast | Single cast at assembly only; document why |
| Factory defaults wrong for one table | Keep defaults minimal; pass options per call |
| Accidental App* rewrite scope creep | Non-goal; reject in review |
| Dual export of features + factory confuses agents | Prefer helper/factory as canonical; features export remains for edge types |

## Out of scope follow-ups

- AppTable / AppCell component registry
- External atoms for table state
- Fine-grained `table.Subscribe` render optimization
- Removing `DataTable` wrapper entirely

## Approval

- Approach B chosen in session
- Design §1–§5 approved as written (2026-08-10)

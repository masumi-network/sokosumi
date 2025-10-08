### Summary

Fix UI bug where newly created job status did not appear updated in the jobs table until a full page refresh. The table columns were memoized, causing stale render behavior when inputs changed.

### Key Changes

- Removed `useMemo` around `getColumns(...)` in `web-app/src/app/(app)/agents/[agentId]/jobs/components/jobs-table.tsx`.
- Compute `columns` inline on each render: `columns={getColumns(userId, t, dateFormatter, queryParam)}`.
- Dropped unused `useMemo` import.

### Why This Change

Memoizing the columns caused stale closures for inputs like `t`, `dateFormatter`, and `queryParam`, preventing the table from reflecting the latest job status state immediately after creating a new job. Recomputing columns on render ensures the cell renderers receive up-to-date props.

### Technical Notes

- This is a small UI fix. Any performance impact is negligible because the columns array is small and computed quickly.
- No changes to data fetching or server logic.

### Testing

Manual verification steps:

1. Navigate to an agent's Jobs page.
2. Create a new job.
3. Observe the job status updates in the table without a full page reload.
4. Interact with filters/sorting; ensure the columns reflect changes immediately.

Local checks:

- `pnpm build` succeeds.
- `pnpm sokosumi-web:start` loads the Jobs page without errors.

### Scope

Front-end (jobs table UI). No server or schema changes.



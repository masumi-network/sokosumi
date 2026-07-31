# Domain pattern triggers

Sokosumi scar-tissue checklist only - not general AGENTS rules. **Not** the review gate.

Dropped (already in AGENTS / skills / Reviewer High): background `waitUntil`, i18n, auth/workspace/web→Core.

| R# | Trigger (match → flag) |
|----|------------------------|
| R1 | Multi-step create/update (form → action → Core), billing + DB, schedule + status |
| R2 | Status enums, kanban, toggles, drag-and-drop, schedule-driven status |
| R3 | PUT/PATCH, schedule saves, notification upserts |
| R4 | Date pickers, cron, `intervalDays`, `runAt`, recurring end dates |
| R6 | Presets, columns, badges, sort order, warning copy |
| R7 | Provider + page + toast + header; realtime + fetch |
| R9 | Sidebar, `Sheet`, modals, header nav |
| R11 | New status, job status, notification kind |
| R12 | `href` builders, admin CRUD, POST responses after sync |

## Load rules

| Role | Load |
|------|------|
| Investigator | This file only. Flag matching `Rn` in pitfalls. Do **not** load `QUALITY-RULES.md`. |
| Tech Lead | This file. For each flagged `Rn`, load **that section only** from `QUALITY-RULES.md`. |
| Coder | This file. Run self-check for flagged `Rn` only. Load matching `QUALITY-RULES.md` sections only if a check is unclear. |
| Reviewer | `PHASE-REVIEWER.md` first. Then this file vs diff. Load matching `QUALITY-RULES.md` sections only. |

Do **not** invent R# when trigger does not match. If Spec/defect and R# both fit → label Spec or defect. Do **not** list every R#.

## Coder self-check (flagged Rn only)

Answer only questions whose Rn was flagged. Fix failing checks before handoff. Not a Reviewer substitute (`PHASE-REVIEWER.md`).

1. R1 - Multi-step writes: order + failure behavior defined and implemented?
2. R2 - Status: one resolver; no stale toggle after schedule/status API?
3. R3 - Updates: no blind re-PUT of unchanged schedule/metadata?
4. R4 - Time: TZ documented and used consistently?
5. R6 - UI labels match API/cron/sort behavior?
6. R7 - Shared client state: races and cross-surface sync handled?
7. R9 - Mobile/sheet/dialog flows correct?
8. R11 - New enums/status: all consumers updated?
9. R12 - Links and POST responses reflect real routes and post-sync state?

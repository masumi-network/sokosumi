# Native SEO user flows

REPORTED: SEO must work inside Sokosumi. Users should not create or configure a personal assistant to use it.

INFERRED: The journeys below define acceptance for the current UX revision. A local test does not prove online completion.

## 1. Start an Audit and choose pages

INFERRED: Open Marketing, then SEO. Enter an Audit name and the first public page URL in the inline form.

INFERRED: The SEO navigation opens Workspace Audits even when a Sokosumi Project was selected. Existing bookmarked Project report links remain readable.

INFERRED: Creating the Audit saves the page collection. It does not create a bot or start a paid check.

INFERRED: Use Pages to add related URLs. Save a page selection when several pages need the same checks.

INFERRED: The page selector limits results, statistics and new checks. Each dispatched check keeps its original page selection.

## 2. Connect Google and read statistics

INFERRED: Overview shows Google Analytics and Search Console connection controls. Choose Connect for the source you need.

INFERRED: Google approval uses a consent window. Its return belongs to SEO, including ordinary-tab and lost-popup recovery.

INFERRED: Successful approval returns to the Audit. An interrupted verification offers Retry verification or Start a new connection.

INFERRED: Choose an authorized property and a period in Sync statistics. Presets cover the last 7, 28 or 90 complete days.

INFERRED: Later syncs retain the saved source and property. A changed Google account must expose that property before reuse.

INFERRED: Statistics retain their own reporting period. Syncing a report does not change Audit activity dates or hide new findings.

INFERRED: Overview shows one saved source snapshot and one selected metric trend. It never adds overlapping periods or distinct-user totals.

INFERRED: Zero means a measured zero. Missing values remain unavailable. Measurement details show coverage, period, time zone and source notes.

INFERRED: Expired or revoked Google consent offers Reconnect. A temporary provider outage offers recovery without claiming consent was revoked.

## 3. Get public results and manage recommendations

INFERRED: Import report accepts a completed, accessible SEO report. Its pages and source evidence must match the selected scope.

INFERRED: Run check creates a bounded Task for the selected pages. The worker must support its requested operations and call limit.

INFERRED: Core selects the configured SEO service. The native forms never ask for a Coworker, bot profile or executor ID.

INFERRED: A service without paid search-data permission offers HTML page checks and HTML-only Audit lite. An explicitly approved paid service also offers rankings, links and full audits.

INFERRED: Schedule checks appears only when the configured service has approved scheduler access. One-off checks can remain available without it.

INFERRED: If checks are unavailable, import an existing report or use connected statistics. First-use copy does not promise a hidden check.

INFERRED: A failed report-detail read offers Retry and keeps the selected Task.

INFERRED: Keywords distinguishes observed results from saved target pages. Only ranked status with a measured position proves a ranking.

INFERRED: Edit changes the target or priority without changing keyword identity.

INFERRED: Competitors distinguishes discovered URLs from confirmed choices. Missing backlink or ranking evidence remains unavailable.

INFERRED: Actions can create one draft Task with source references. Later compatible passing checks remove superseded, unlinked recommendations.

INFERRED: Completing a Task records implementation. Verification requires a later compatible check of the referenced findings.

## 4. Follow changes and ask SEO chat

INFERRED: Timeline shows checks, status, report imports, statistics syncs, action Tasks and page-change notes.

INFERRED: Failed checks remain visible. Run a new check opens a fresh request for the currently selected pages.

INFERRED: Monitoring has a finite schedule. Pause, resume and end controls manage future Runs without adding unlimited manual retries.

INFERRED: SEO chat opens inside the Audit. It explains authorized results and proposes native forms or connection controls.

INFERRED: Chat history and private Google statistics stay with the current reader and Workspace context.

## 5. Online acceptance still required

| Journey                 | Required online evidence                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| Audit and pages         | Created through the real UI, visible after reload, correct selected pages                                  |
| Google connection       | Real approval returns to the same Audit; cancellation, retry and reconnect stay inside SEO                 |
| Statistics              | Authorized properties load, sync persists, saved setup reopens, totals and trend match the selected source |
| Reports and watchlists  | Real report import, saved keyword edit, correct target page, competitor confirmation survives reload       |
| Actions and checks      | One source-linked draft Task, bounded worker execution, imported result and truthful verification state    |
| Monitoring and timeline | A finite scheduled Run, pause/resume behavior, visible success and failure states                          |
| Chat                    | A real reply inside the Audit, working native proposals, no personal assistant onboarding                  |
| Access and layout       | Viewer/Workspace isolation, keyboard controls, narrow screen, loading and recoverable errors               |

## Least confident decisions

1. INFERRED: Live Google consent behavior needs the owner's signed-in browser and an authorized Google account.
2. INFERRED: Automatic monitoring needs a scheduler that targets this feature Preview's database and isolated worker context.
3. REPORTED: Release records show the paid-provider test allowance at `32/32`. Additional paid-provider executions require a new allowance.

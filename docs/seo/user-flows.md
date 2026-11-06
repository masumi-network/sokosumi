# Native SEO user flows

REPORTED: SEO must work inside Sokosumi. Users should not create or configure a personal assistant to use it.

INFERRED: The journeys below define acceptance for the current UX revision. A local test does not prove online completion.

## 1. Start an Audit and choose pages

INFERRED: Open Marketing, then SEO. Enter an Audit name and the first public page URL in the inline form.

INFERRED: The SEO navigation opens Workspace Audits even when a Sokosumi Project was selected. Existing bookmarked Project report links remain readable.

INFERRED: SEO hides the global Project selector on desktop and mobile. An Audit belongs to the active organization Workspace. A linked Sokosumi Project adds its scope and lifecycle checks.

INFERRED: Creating the Audit saves the page collection. It does not create a bot or start a paid check.

INFERRED: Use Pages to add related URLs. Save a page selection when several pages need the same checks.

INFERRED: The page selector limits results, statistics and new checks. Each dispatched check keeps its original page selection.

## 2. Connect Google and read statistics

INFERRED: Overview shows Google Analytics and Search Console connection controls. Choose Connect for the source you need.

INFERRED: Google approval uses a consent window. Its return belongs to SEO, including ordinary-tab and lost-popup recovery.

INFERRED: Successful approval returns to the Audit. Interrupted verification offers provider-specific retry and restart controls.

INFERRED: Choose an authorized property and a period in Sync statistics. Presets cover the last 7, 28 or 90 complete days.

INFERRED: Later syncs retain the saved source and property. A changed Google account must expose that property before reuse.

INFERRED: Organization members with access to this Audit can read its newly saved statistics. Google account consent and account controls remain with the person who connected it. Personal Workspace statistics remain personal.

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

INFERRED: Organization Audit chat is shared with its authorized members. Questions identify their authors. Personal Workspace conversations remain private.

INFERRED: Existing private conversations and statistics are excluded from the new shared history and model context. The sharing migration does not publish those records.

## 5. Online acceptance still required

REPORTED: The owner chose `https://www.battery-sensei.app/` because its Google Search Console property is available to their Google account.

VERIFIED: On deployed revision `b59f0b8ffa`, the real Preprod UI created Audit `01a1b014-b853-71da-b7b8-5fe2d643456c` for Battery Sensei. A saved `MacBook battery health` keyword retained its target URL and edited High priority after reload. A manually chosen competitor displayed its confirmation separately from unavailable ranking and link measurements. These checks do not prove the subsequent source corrections are deployed.

VERIFIED: Revision `2cc506ba429e0c09353a7b28a8ca557492335537` deployed through [Preview workflow 42197656370](https://github.com/masumi-network/sokosumi/actions/runs/42197656370). Core and Web reported `READY`. [CI 42197528651](https://github.com/masumi-network/sokosumi/actions/runs/42197528651) passed. The signed-in Battery Sensei Audit now hides the Project selector and shows the organization-sharing notice. A real chat reply named the saved keyword and competitor, identified missing measurements, and stayed inside the Audit.

VERIFIED: The approved read-only managed-project check ended with `config_read_failed`. It returned no verifier configuration and made no configuration change. The owner's personal Composio account does not identify the managed integration.

INFERRED: The next source correction preserves the managed verifier URL. Its exact raw return enters the existing consent relay. Stored native context returns to the initiating SEO origin. Ordinary bot verification still requires its existing authenticated owner path. Live acceptance requires the canonical Preprod Web relay rollout and the updated PR Preview.

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

## Results and activity graph revision

INFERRED: Overview should lead with recommended work and real issues. A normal title length belongs in closed Check details. An empty recommendation list should explain the measured scope and offer a useful next step.

INFERRED: Timeline should connect dated events across the selected pages. A check uses its measurement time; its later save time remains in details. Comparable page checks can be labeled Recheck. Ranking and Audit lite runs need more request identity before making that comparison.

INFERRED: An action node shows when its Task was linked and the Task's current status. It does not invent an implementation or verification date. Source Task links and failed-check recovery remain available.

INFERRED: A Workspace mismatch should explain the unavailable Audit and link to the current Workspace's Audit list. It should keep the existing access checks and should not switch Workspaces automatically.

## Least confident decisions

1. VERIFIED: The consent attempts reached main Preprod's protected `/personal-assistant/integrations/verify`, then sign-in. Native popup closure remains unverified online. The source correction preserves the managed project's setting; a personal Composio admin account is not required.
2. INFERRED: Automatic monitoring needs a scheduler that targets this feature Preview's database and isolated worker context.
3. REPORTED: Release records show the paid-provider test allowance at `32/32`. Additional paid-provider executions require a new allowance.

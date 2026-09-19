# Making the Xcode Cloud result a required check

Researched 2026-09-19.

## Decision

**None of the four options below. Xcode Cloud builds releases only; pull requests
and `main` are tested by GitHub Actions.** The `Xcode test` job in
`.github/workflows/apple.yml` runs the same one-command `Sokosumi` workspace
scheme test the research describes, on a runner that already reports a check GitHub
can require. The Xcode Cloud context is never required, so the reporting gap
documented here stops mattering. The findings stay recorded because they are the
reason: do not try to require an Xcode Cloud context later without re-reading
them.

## The question

Apple tests run on Xcode Cloud: one `Sokosumi` workspace scheme covering the app suite and all five package suites, started by a workflow whose Files and Folders start condition is restricted to `apps/apple/**`. We want that result in the `Default Branch` ruleset (id 3855070) as a required status check, the way `Swift lint and format` already is. A GitHub required status check blocks a pull request forever if the named context never reports, so everything turns on one fact: when the Files and Folders filter excludes a change, does Xcode Cloud report a check run with some non-blocking conclusion, or does it report nothing at all?

## Findings

**Xcode Cloud only contacts the SCM provider when it starts a build.** Apple describes the mechanism as watch, evaluate, start: "Xcode Cloud watches your Git repository for changes, checks whether a change meets start conditions you configure for your workflows, and starts a build when a change meets one of the conditions." Nothing in the page describes an output for a change that meets no condition. ([Configuring start conditions](https://developer.apple.com/documentation/xcode/configuring-start-conditions))

**A Files and Folders custom condition is a start/don't-start switch, not a result.** "You can configure a custom condition to either start or skip a build", and "A start condition's Custom Conditions setting can either start or skip a build, not both." The word *skip* here means the build never runs; the page does not attach any reported status to it. ([Configuring start conditions](https://developer.apple.com/documentation/xcode/configuring-start-conditions))

**Apple documents a visible "skipped" indication for exactly one mechanism, and it is not the folder filter.** Under *Skip a build*, describing the `[ci skip]` commit-message tag: "If you require Xcode Cloud builds or actions to succeed before users can merge a PR, the website for a PR indicates that Xcode Cloud skipped a build for the most recent change." That sentence sits in the `[ci skip]` section only. The Files and Folders section, two sections earlier, has no equivalent. Apple does not say whether the PR indication is a check run, what conclusion it carries, or whether it satisfies a required check. **Undocumented.** ([Configuring start conditions](https://developer.apple.com/documentation/xcode/configuring-start-conditions))

**Apple's own WWDC walkthrough of the Files and Folders condition says nothing about reporting either.** The session demonstrates excluding a `docs` folder — "My goal is to not start builds when the docs folder is modified" — and separately describes `[ci skip]`, without ever discussing what the pull request shows for an excluded change. ([Get the most out of Xcode Cloud, WWDC22 session 110374](https://developer.apple.com/videos/play/wwdc2022/110374/))

**Observed in this repository: a filtered-out change produces zero Xcode Cloud check runs.** Querying `GET /repos/masumi-network/sokosumi/commits/{sha}/check-runs` for the head commits of four recent merged PRs: #4829 and #4824 (both touch `apps/apple/**`) each carry two check runs from app `xcode-cloud`; #4830 and #4831 (Core and database only) carry zero check runs from that app — not a pending one, not a skipped one, none. This is direct observation of our own repository, not an Apple statement, but it matches the documentation's silence. Nothing here exercises the `[ci skip]` path, which remains untested.

**The check runs are Checks, owned by Apple's `xcode-cloud` GitHub App, integration id 117084.** `GET /apps/xcode-cloud` returns `{"id": 117084, "slug": "xcode-cloud", "owner": "apple"}`. Installing that app is how Xcode Cloud is granted repository access in the first place: "GitHub uses the app to grant Xcode Cloud access to your repository." ([Connecting Xcode Cloud to GitHub](https://developer.apple.com/documentation/xcode/connecting-xcode-cloud-to-github); app id read from the GitHub REST API)

**The check name embeds the product, the workflow name, and the action — so it changes if the workflow is renamed.** Observed names on #4829 and #4824: `Sokosumi | Pull Requests | Test - macOS` and `Sokosumi | Pull Requests | Build - macOS`. Apple documents that per-action granularity exists — "you can require that an entire Xcode Cloud build must succeed before it's possible to merge a PR, or you can require that a specific Xcode Cloud action must succeed" — but **does not document the naming format**. The format above is observed, not specified. ([Configuring requirements for merging a pull request](https://developer.apple.com/documentation/xcode/configuring-requirements-for-merging-a-pull-request))

**Apple explicitly supports required status checks and points at GitHub's documentation for them.** "Xcode Cloud supports these branch protection features." GitHub's side is named as status checks and linked from Apple's page. ([Configuring requirements for merging a pull request](https://developer.apple.com/documentation/xcode/configuring-requirements-for-merging-a-pull-request))

**No `ci_script` can cancel or short-circuit a build into a non-failure.** Apple documents exactly three script names and one exit-code contract: "if a command fails, return a nonzero exit code. By returning a nonzero exit code in your custom build script, you let Xcode Cloud know that something went wrong and let it fail the build". Nonzero fails; zero continues. There is no documented exit code, API call, or file-drop that ends a build early as skipped, neutral, or cancelled, and scripts cannot escalate privileges ("You can't obtain administrator privileges by using `sudo`"). **Undocumented — and the absence is in a page that otherwise specifies the script contract completely.** ([Writing custom build scripts](https://developer.apple.com/documentation/xcode/writing-custom-build-scripts))

**No predefined `CI_*` variable reports a skip, and none is needed to detect one.** The complete documented set is `CI_XCODE_CLOUD`, `CI_BUILD_ID`, `CI_BUILD_NUMBER`, `CI_BUILD_URL`, `CI_BUNDLE_ID`, `CI_COMMIT`, `CI_BRANCH`, `CI_TAG`, `CI_GIT_REF`, `CI_START_CONDITION`, `CI_WORKFLOW`, `CI_WORKFLOW_ID`, `CI_PRODUCT`, `CI_PRODUCT_ID`, `CI_PRODUCT_PLATFORM`, `CI_TEAM_ID`, `CI_PROJECT_FILE_PATH`, `CI_WORKSPACE_PATH`, `CI_XCODE_PROJECT`, `CI_XCODE_SCHEME`, `CI_PRIMARY_REPOSITORY_PATH`, `CI_DERIVED_DATA_PATH`, `CI_XCODEBUILD_ACTION`, `CI_XCODEBUILD_EXIT_CODE`, the seven `CI_PULL_REQUEST_*` variables, the test-action and archive-action variables, and the signed-app paths. A script only runs inside a build that already started, so there is nothing for such a variable to describe. ([Environment variable reference](https://developer.apple.com/documentation/xcode/environment-variable-reference))

**Webhooks fire on build lifecycle events only.** "Xcode Cloud sends an HTTP request to each webhook's configured HTTPS endpoint every time it creates, starts, and finishes a build" — `BUILD_CREATED`, `BUILD_STARTED`, `BUILD_COMPLETED`. A change that starts no build creates no build, so it fires no webhook. Up to five webhooks per product; Xcode Cloud retries until it gets a success response or 30 seconds elapse. ([Configuring webhooks in Xcode Cloud](https://developer.apple.com/documentation/xcode/configuring-webhooks-in-xcode-cloud), [Webhook payload](https://developer.apple.com/documentation/xcode/webhook-payload))

**GitHub: a workflow skipped by path filtering leaves its checks pending and blocks the merge.** "If a workflow is skipped due to path filtering, branch filtering or a commit message […] then checks associated with that workflow will remain in a 'Pending' state. A pull request that requires those checks to be successful will be blocked from merging." The troubleshooting page repeats this and offers only one remedy: "Avoid requiring workflows that can be skipped." ([Skip workflow runs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs), [Troubleshooting required status checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks))

**GitHub: a job skipped inside a workflow that did run counts as success.** "A job that is skipped will report its status as 'Success'. It will not prevent a pull request from merging, even if it is a required check." This is the mechanism `.github/workflows/apple.yml` already relies on — `Swift lint and format` is gated by `if: needs.changes.outputs.apple == 'true' || …`, so on a non-Apple PR the job is skipped, the check reports, and the ruleset is satisfied. ([Status checks](https://docs.github.com/en/pull-requests/reference/status-checks))

**GitHub: `skipped` and `neutral` check-run conclusions are both treated as success.** `skipped` — "The check run was skipped. This is treated as a success for dependent checks in GitHub Actions." `neutral` — "The check run completed with a neutral result. This is treated as a success for dependent checks." Blocking conclusions are `failure`, `timed_out`, and `action_required`. ([Status checks](https://docs.github.com/en/pull-requests/reference/status-checks))

**GitHub: a required status check is bound to one expected app.** "When you add a required status check rule, you can select an app as the expected source of status updates", and that app "must have recently submitted a check run". Our ruleset's eight existing required contexts are all pinned to `integration_id: 15368` (GitHub Actions). A context satisfied by Xcode Cloud would have to be pinned to 117084 instead — a different app cannot satisfy it. ([Available rules for rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets); integration ids read from `gh api repos/masumi-network/sokosumi/rulesets/3855070`)

**GitHub: only a GitHub App can create a check run.** "Write permission for the REST API to interact with checks is only available to GitHub Apps." Allowed conclusions on `POST /repos/{owner}/{repo}/check-runs` are `success`, `failure`, `neutral`, `cancelled`, `skipped`, `timed_out`, `action_required`. A GitHub Actions job's own name already becomes a check run owned by app 15368, which is the ordinary way to produce one without registering an app. ([REST API endpoints for check runs](https://docs.github.com/en/rest/checks/runs))

**The App Store Connect API can read Xcode Cloud build runs, but not by commit.** `ciBuildRuns` "represents an Xcode Cloud build. Use it to get a list of builds Xcode Cloud performed and access detailed information for a specific build". The list endpoints `GET /v1/ciProducts/{id}/buildRuns` and `GET /v1/ciWorkflows/{id}/buildRuns` accept only `filter[builds]` (App Store Connect builds, not commits), plus `include`, `sort`, `limit`, and `fields[…]`. **There is no documented filter by commit SHA, branch, or pull request** — a caller must page recent runs and match `sourceCommit.commitSha` (fields: `author`, `commitSha`, `committer`, `message`, `webUrl`) or follow the `pullRequest` relationship itself. ([ciBuildRuns](https://developer.apple.com/documentation/appstoreconnectapi/build-runs), [GET /v1/ciProducts/{id}/buildRuns](https://developer.apple.com/documentation/appstoreconnectapi/GET-v1-ciProducts-_id_-buildRuns))

**`CiBuildRun` carries exactly the fields a poller needs, including a documented `SKIPPED` status.** `executionProgress` is one of `PENDING`, `RUNNING`, `COMPLETE`; `completionStatus` is one of `SUCCEEDED`, `FAILED`, `ERRORED`, `CANCELED`, `SKIPPED`. Other attributes: `number`, `createdDate`, `startedDate`, `finishedDate`, `isPullRequestBuild`, `startReason` (`GIT_REF_CHANGE`, `MANUAL`, `MANUAL_REBUILD`, `PULL_REQUEST_OPEN`, `PULL_REQUEST_UPDATE`, `SCHEDULE`), `cancelReason`, `issueCounts`, `sourceCommit`, `destinationCommit`; relationships `workflow`, `product`, `actions`, `builds`, `pullRequest`, `sourceBranchOrTag`, `destinationBranch`. A run that is still queued reads `executionProgress: PENDING` with no `completionStatus`. **Apple does not document which conditions produce `SKIPPED`** — in particular, whether a Files and Folders exclusion creates a `SKIPPED` run or creates no run at all. Our repository observation (no check run on non-Apple PRs) suggests no run, but we did not query the API to confirm. ([CiBuildRun.Attributes](https://developer.apple.com/documentation/appstoreconnectapi/CiBuildRun), [CiCompletionStatus](https://developer.apple.com/documentation/appstoreconnectapi/cicompletionstatus), [CiExecutionProgress](https://developer.apple.com/documentation/appstoreconnectapi/ciexecutionprogress))

**App Store Connect API auth is an ES256-signed JWT from an App Store Connect API key.** Header fields are `alg: ES256` ("All JWTs for App Store Connect API must be signed with ES256 encryption"), `kid` (the private key ID from Users and Access → Integrations), and `typ: JWT`. The `ciBuildRuns` resource additionally "supports JSON web tokens with a lifetime of up to six months", unlike the default short lifetime. Storing that key as a GitHub Actions secret is a private-signing-key secret, not a token. ([Generating tokens for API requests](https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests), [ciBuildRuns](https://developer.apple.com/documentation/appstoreconnectapi/build-runs))

**Running unfiltered costs real compute hours; there is no documented no-op action.** A compute hour is "an hour of time used to execute a specific task in the cloud, such as building an app or running automated tests"; the Apple Developer Program includes 25 per month, and paid tiers start at 100 for US$49.99/month. A workflow must perform at least one of Build, Test, Analyze, or Archive — Apple documents no empty or no-op action. Xcode Cloud parallelizes, so "the time it takes to complete a build and the usage time Xcode Cloud reports are different": a wall-clock build can bill more than its duration. Auto-cancel Builds is on by default per start condition and cancels an in-progress build when a newer one for the same workflow queues, which limits waste on a busy branch. ([Xcode Cloud](https://developer.apple.com/xcode-cloud/), [Xcode Cloud workflow reference](https://developer.apple.com/documentation/xcode/xcode-cloud-workflow-reference), [Reviewing Xcode Cloud usage data](https://developer.apple.com/documentation/xcode/reviewing-xcode-cloud-usage-data))

## What this means for Sokosumi

The core finding is a dead end for the naive version: adding `Sokosumi | Pull Requests | Test - macOS` to ruleset 3855070 as-is would leave every non-Apple PR — the overwhelming majority — waiting on a context that Xcode Cloud never reports. GitHub's own guidance for that shape is "avoid requiring workflows that can be skipped". Four routes get around it, with different bills.

**Drop the Files and Folders condition and require the check directly.** The only option that needs no new moving parts: every PR starts an Xcode Cloud build, so the context always reports. It costs a full macOS build-and-test of the workspace scheme on every PR in the monorepo, most of which touch no Swift, billed against a 25 compute-hour monthly allowance that a single `Sokosumi` run is unlikely to fit inside for long. There is no cheaper no-op action to substitute. Auto-cancel limits rapid re-pushes but not the baseline volume. Requires only a workflow edit in App Store Connect and a ruleset entry pinned to integration id 117084.

**Keep the filter and add a GitHub Actions proxy job that polls the App Store Connect API.** A job in `.github/workflows/apple.yml` alongside the existing `changes` + `lint` pair: when `changes.outputs.apple != 'true'` the job's `if:` skips it and GitHub reports it as success (the mechanism `Swift lint and format` already uses); otherwise it signs an ES256 JWT, pages `GET /v1/ciWorkflows/{id}/buildRuns`, matches `sourceCommit.commitSha` against the PR head, waits out `executionProgress: PENDING`/`RUNNING`, and exits on `completionStatus`. The required context is then the proxy job's own name, owned by app 15368 like the other seven, so the ruleset stays homogeneous. Costs: an App Store Connect API private key as a repository secret (six-month JWT lifetime is permitted for this resource); a hand-written poll loop with no SHA filter available, so it pages and matches client-side; a second timeout to tune on top of Xcode Cloud's; and a race at PR open, where the run may not exist yet and "absent" is indistinguishable from "not created". It does not consume extra Xcode Cloud compute.

**Keep the filter and drive the mirror from an Xcode Cloud webhook instead of polling.** Same shape, push rather than pull: a webhook on `BUILD_COMPLETED` hits an endpoint that creates a check run on the head commit. This removes the poll loop and the race, but needs a public HTTPS endpoint that responds within 30 seconds and a GitHub App to author the check run — `POST /check-runs` is App-only — so it is the heaviest option in infrastructure and the only one that adds a service to operate. Web's Vercel deployment could host the endpoint; the GitHub App is new.

**Leave the ruleset alone and treat Xcode Cloud as advisory.** Today's state. The Xcode Cloud check appears on Apple PRs and is visible in review; `Swift lint and format` remains the only enforced Apple gate. Costs nothing and requires nothing; buys no enforcement, so a red macOS test run can be merged by anyone who does not look.

One constraint cuts across the last three: the Xcode Cloud check name embeds the workflow name (`Sokosumi | Pull Requests | …`), and that format is observed rather than documented. Renaming the Xcode Cloud workflow silently renames the context. If a required context is ever pinned to app 117084, that rename breaks every PR — the same failure mode `apps/apple/AGENTS.md` already warns about for deleting `.github/workflows/apple.yml`.

## Sources

Apple, primary:

- https://developer.apple.com/documentation/xcode/configuring-start-conditions
- https://developer.apple.com/documentation/xcode/configuring-requirements-for-merging-a-pull-request
- https://developer.apple.com/documentation/xcode/connecting-xcode-cloud-to-github
- https://developer.apple.com/documentation/xcode/writing-custom-build-scripts
- https://developer.apple.com/documentation/xcode/environment-variable-reference
- https://developer.apple.com/documentation/xcode/xcode-cloud-workflow-reference
- https://developer.apple.com/documentation/xcode/configuring-webhooks-in-xcode-cloud
- https://developer.apple.com/documentation/xcode/webhook-payload
- https://developer.apple.com/documentation/xcode/reviewing-xcode-cloud-usage-data
- https://developer.apple.com/xcode-cloud/
- https://developer.apple.com/videos/play/wwdc2022/110374/
- https://developer.apple.com/documentation/appstoreconnectapi/xcode-cloud-workflows-and-builds
- https://developer.apple.com/documentation/appstoreconnectapi/build-runs
- https://developer.apple.com/documentation/appstoreconnectapi/GET-v1-ciProducts-_id_-buildRuns
- https://developer.apple.com/documentation/appstoreconnectapi/GET-v1-ciWorkflows-_id_-buildRuns
- https://developer.apple.com/documentation/appstoreconnectapi/CiBuildRun
- https://developer.apple.com/documentation/appstoreconnectapi/cicompletionstatus
- https://developer.apple.com/documentation/appstoreconnectapi/ciexecutionprogress
- https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests

GitHub, primary:

- https://docs.github.com/en/pull-requests/reference/status-checks
- https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks
- https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- https://docs.github.com/en/rest/checks/runs

Live API reads against this repository (primary observation, not documentation):

- `GET /apps/xcode-cloud`
- `GET /repos/masumi-network/sokosumi/commits/{sha}/check-runs` for PRs #4824, #4829, #4830, #4831
- `GET /repos/masumi-network/sokosumi/rulesets/3855070`

No secondary sources were used.

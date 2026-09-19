# Why Xcode Cloud is not a required check

Researched 2026-09-19, when Apple tests moved back to GitHub Actions
(`Xcode test` in `.github/workflows/apple.yml`) and Xcode Cloud was reduced to
building releases.

Read this before proposing that the Xcode Cloud result become a required status
check on `main`. It cannot, and the reason is not written down by Apple.

## The finding

A start condition filtered to `apps/apple/**` reports **nothing at all** on a
change it excludes — not a skipped check run, not a neutral one, not a pending
one. Name that context in ruleset 3855070 and every non-Apple pull request, the
overwhelming majority, waits forever on a check that never arrives.

**Apple does not document this.** The docs describe start conditions as
watch/evaluate/start and simply never say what a non-start produces; the
finding below is an absence in the documentation plus a direct observation of
this repository.

- **Xcode Cloud only contacts the SCM provider when it starts a build.** It
  "watches your Git repository for changes, checks whether a change meets start
  conditions […] and starts a build when a change meets one of the conditions."
  A Files and Folders condition "can either start or skip a build, not both" —
  a switch, not a result. ([Configuring start conditions](https://developer.apple.com/documentation/xcode/configuring-start-conditions))
- **Apple documents a visible "skipped" indication for exactly one mechanism,
  and it is not the folder filter.** The sentence "the website for a PR
  indicates that Xcode Cloud skipped a build" appears only in the `[ci skip]`
  commit-tag section. Whether that indication is a check run, what conclusion
  it carries, and whether it satisfies a required check are all **undocumented**.
  ([Configuring start conditions](https://developer.apple.com/documentation/xcode/configuring-start-conditions))
- **Observed in this repository: zero check runs.** `GET /repos/masumi-network/sokosumi/commits/{sha}/check-runs`
  on four merged PRs — #4829 and #4824 (touch `apps/apple/**`) each carry two
  check runs from app `xcode-cloud`; #4830 and #4831 (Core/database only) carry
  none. Direct observation, not an Apple statement. The `[ci skip]` path is
  untested.
- **No script can rescue it.** No `CI_*` variable reports a skip and none could:
  a `ci_script` only runs inside a build that already started. No exit code ends
  a build as anything but success or failure.
  ([Environment variable reference](https://developer.apple.com/documentation/xcode/environment-variable-reference))

## Why GitHub Actions does not have this problem

**A job skipped inside a workflow that ran reports Success** — "It will not
prevent a pull request from merging, even if it is a required check." That is
exactly what `.github/workflows/apple.yml` relies on: `Xcode test` and
`Swift lint and format` are both gated on `needs.changes.outputs.apple`, so on a
non-Apple PR they skip, the checks still report, and the ruleset is satisfied.

The failure mode is specific to a workflow that never *starts*: "If a workflow is
skipped due to path filtering […] checks associated with that workflow will
remain in a 'Pending' state. A pull request that requires those checks to be
successful will be blocked from merging." GitHub's own remedy is one line —
"Avoid requiring workflows that can be skipped."
([Status checks](https://docs.github.com/en/pull-requests/reference/status-checks),
[Troubleshooting required status checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks))

## Two traps if anyone tries again

- **A required context is pinned to one app.** Our eight required contexts all
  name `integration_id: 15368` (GitHub Actions). An Xcode Cloud context would
  have to be pinned to 117084; a different app cannot satisfy it.
  ([Available rules for rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets))
- **The Xcode Cloud check name embeds the workflow name** — ours reads
  `Sokosumi | Pull Requests | Test - macOS`. That format is observed, not
  documented, so renaming the workflow in App Store Connect would silently
  rename the required context and block every PR.

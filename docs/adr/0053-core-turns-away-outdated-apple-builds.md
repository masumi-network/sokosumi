# Core turns away outdated Apple builds

Core removes operations, such as `GET`/`PUT /v1/users/{id}/preferred-organization` in #5876. Apple builds already installed keep calling them, and Core answered a plain-text `404 Not Found` that the app showed as "Couldn't reach Core". Every Mac request to `/v1` now names its build in `X-Sokosumi-Client: macos/<build>`. The Developer ID disk image is the only published Mac build: TestFlight builds were removed in the first release preparation (SOK-1325). Core reads one minimum, `MACOS_MINIMUM_BUILD`. It answers a build below it with **426** and `kind: "client_update_required"`, and the app replaces the error with update copy that links `https://github.com/masumi-network/sokosumi/releases/download/macos-latest/Sokosumi.dmg`, the permanent download in [ADR 0054](0054-mac-app-updates-itself-from-macos-latest.md). Core's catch-all 404 is now the JSON error envelope with `kind: "route_not_found"`, so an app that reaches a removed operation shows the same update copy without waiting for a minimum.

## Considered Options

- **Marketing version (`1.0`).** It never changed before Release Please. Build numbers already increase: the DMG job archives with `CURRENT_PROJECT_VERSION = github.run_number`.
- **One minimum per channel.** The first version gated `developer-id` and `app-store` (Xcode Cloud and TestFlight) apart, because their counters are unrelated. With TestFlight gone the channel says nothing, so the header is `macos/<build>`. No published build is in use, so Core accepts only that form.
- **A version endpoint the app polls.** The app would also need a check on every launch and on resume, and it would still fail the first time it calls a removed operation. A middleware check in Core needs nothing new on the client beyond the header.
- **Treat every undocumented 404 as outdated.** An operation that does not document 404 can still answer one for a missing resource, and telling that person to update would be wrong. Matching `route_not_found` is exact.
- **410 Gone.** It describes the resource. 426 describes the client, and Core already names it `UpgradeRequired`.

## Consequences

- The gate covers `/v1` only. `/auth` keeps refreshing tokens, so an outdated build stays signed in and works again once updated.
- Build 1 is the project default, which every published build overrides, so a local build is never gated, even against production Core.
- Only builds that send the header can be gated. No published build was in use when this shipped, so Core reads no User-Agent fallback.
- Removing an operation the Apple snapshot ever selected: set `MACOS_MINIMUM_BUILD` to the first published build that no longer calls it, then remove it. For the DMG that is the `Apple` workflow `push` run on `main` for the merge commit (`gh run list -w Apple -b main -e push`).
- An unset minimum gates nothing, so local and preview Core run without them. Raising it is an environment change and a redeploy on Vercel.

# Core turns away outdated Apple builds

Core removes operations, such as `GET`/`PUT /v1/users/{id}/preferred-organization` in #5876. Apple builds already installed keep calling them, and Core answered a plain-text `404 Not Found` that the app showed as "Couldn't reach Core". Every Apple request to `/v1` now names its build in `X-Sokosumi-Client: macos-<channel>/<build>`, where the channel is `developer-id` (the `apple-latest` DMG) or `app-store` (Xcode Cloud, TestFlight and the App Store). Core reads one minimum per channel, `MACOS_DEVELOPER_ID_MINIMUM_BUILD` and `MACOS_APP_STORE_MINIMUM_BUILD`. It answers a build below its minimum with **426** and `kind: "client_update_required"`, and the app replaces the error with update copy. The DMG copy links `https://github.com/masumi-network/sokosumi/releases/download/apple-latest/Sokosumi.dmg`. Core's catch-all 404 is now the JSON error envelope with `kind: "route_not_found"`, so an app that reaches a removed operation shows the same update copy without waiting for a minimum.

## Considered Options

- **Marketing version (`1.0`).** It never changes. Build numbers already increase: the DMG job archives with `CURRENT_PROJECT_VERSION = github.run_number`, and Xcode Cloud numbers its own builds. The two counters are unrelated, so each channel needs its own minimum.
- **A version endpoint the app polls.** The app would also need a check on every launch and on resume, and it would still fail the first time it calls a removed operation. A middleware check in Core needs nothing new on the client beyond the header.
- **Treat every undocumented 404 as outdated.** An operation that does not document 404 can still answer one for a missing resource, and telling that person to update would be wrong. Matching `route_not_found` is exact.
- **410 Gone.** It describes the resource. 426 describes the client, and Core already names it `UpgradeRequired`.

## Consequences

- The gate covers `/v1` only. `/auth` keeps refreshing tokens, so an outdated build stays signed in and works again once updated.
- Build 1 is the project default, which every published build overrides, so a local build is never gated, even against production Core.
- Builds published before the header name themselves only in URLSession's default User-Agent (`Sokosumi/<build> CFNetwork/…`). Core gates those as `developer-id` from build 3125, the Apple workflow run that published the first DMG. Older User-Agent builds come from Xcode Cloud or a local machine and are never gated. These builds do not know the 426. The 426 message names the update and the link, so a build that shows Core's message still says what to do.
- Removing an operation the Apple snapshot ever selected: set the channel minimums to the first published builds that no longer call it, then remove it. For the DMG that is the `Apple` workflow `push` run on `main` for the merge commit (`gh run list -w Apple -b main -e push`).
- Unset minimums gate nothing, so local and preview Core run without them. Raising one is an environment change and a redeploy on Vercel.

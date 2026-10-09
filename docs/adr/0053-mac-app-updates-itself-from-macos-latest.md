# The Mac app updates itself with Sparkle from the `macos-latest` release

The direct-download Mac app updates itself with Sparkle. Release Please versions it as its own component, tagged `macos-v1.2.3` so a future iOS app can take `ios-v…`, and each Stable release is published as an appcast and disk image on one fixed GitHub release, `macos-latest`. Sparkle reads `releases/download/macos-latest/appcast.xml`, which is baked into every shipped app, so moving the feed later strands every install that cannot reach the new address.

## Considered Options

- **`releases/latest/download/appcast.xml`.** GitHub's Latest release is whatever was published last, and the CLI already publishes `cli-v…` releases from this repository.
- **Serve the appcast from `apps/web`.** It would tie every Mac release to a web deploy.
- **A Beta track in Sparkle now.** Deferred: Beta builds are a single rolling `macos-beta` prerelease that testers install by hand. A Sparkle Beta track would need one release per Beta build, so that a feed item never changes under its signature.
- **Sparkle in every build.** The Mac App Store forbids self-updaters and TestFlight already updates Alpha builds, so Sparkle is compiled into the Developer ID build only.
  - *2026-10-09:* the TestFlight track and Alpha builds were removed, so the Developer ID build is the only published build. Sparkle is linked into every build of the app target, and the updater starts only when the build names the `developer-id` distribution channel, never in ad hoc, Debug or local builds.

## Consequences

- Sparkle's EdDSA private key is a repository secret with a backup in the masumi 1Password vault. Losing it means no shipped app can accept another update.
- Beta builds and Stable releases come from the same workflow and take its run number as their build number, so a later build always carries a higher one and a tester on a Beta build is offered the next Stable release.
- `apple-latest` is retired. `macos-latest/Sokosumi.dmg` is the permanent download link and always holds the newest Stable release.
- Sparkle's system profiling stays off.

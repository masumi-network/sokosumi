# Archived shared native clamp-height trial

**Decision: leave this trial unapplied for the first release.** The shared native
measurement works and preserves the checked behavior, but older-page stalls do
not improve reliably. See [findings.md](findings.md) and [measurements.json](measurements.json).

| Artifact | Purpose |
| --- | --- |
| [trial.patch](trial.patch) | Exact four production Swift files and four test files from the completed trial; no profiling instrumentation. |
| [measurements.json](measurements.json) | Six original paging runs, fixture/source hashes, protocol, environment/signing, and native-test result summaries. |
| [build-paging.py](build-paging.py) | Recorded production paging adapter, using the repository's existing harness; copies a checkout into a disposable workspace. |
| [measure-paging.py](measure-paging.py) | Original three paired fresh-process cycles, count/fingerprint checks, and raw-output collection. |
| [check-archive.py](check-archive.py) | Offline patch application, production source hashes, raw-result arithmetic, and before/after source preparation. |

The adapter preserves the measured callback clock, prepared-publication markers,
native scrollbar/Core request sequence, and hidden/shared measurement counters.
Only checkout/output/cache paths are parameterized. It does not run the earlier
rich-row content transformations. A Debug build disables the timed loop in the
test host through `HITCH_INSPECT=1`.

To verify the archive without building or profiling, run from the repository root:

```bash
python3 apps/apple/prototypes/lazy-prepend/shared-height-trial/check-archive.py
```

## Replay the exact baseline and trial

Run from the repository root after the first release, with Xcode 27, Python 3,
and the installed Developer ID certificate for team `GVWN7HXYJB`. Build output
must be fresh and outside the checkout. The scripts reuse Xcode's Derived Data;
set `REPRO_DERIVED_DATA` to an existing cache to choose it explicitly.

```bash
git worktree add --detach /tmp/shared-height-before 591392e814f4e3ef6006a4252b0d641ba3affb2f
git worktree add --detach /tmp/shared-height-after 591392e814f4e3ef6006a4252b0d641ba3affb2f
git -C /tmp/shared-height-after apply --check "$PWD/apps/apple/prototypes/lazy-prepend/shared-height-trial/trial.patch"
git -C /tmp/shared-height-after apply "$PWD/apps/apple/prototypes/lazy-prepend/shared-height-trial/trial.patch"
```

Build the two Release fixtures sequentially. These are local profiling builds,
not notarized distribution builds. Signing matches the recorded Developer ID
identity; there is no ad-hoc fallback. No live services or credentials are needed.

```bash
python3 apps/apple/prototypes/lazy-prepend/shared-height-trial/build-paging.py \
  /tmp/shared-height-before /tmp/shared-height-before-release
python3 apps/apple/prototypes/lazy-prepend/shared-height-trial/build-paging.py \
  /tmp/shared-height-after /tmp/shared-height-after-release
python3 apps/apple/prototypes/lazy-prepend/shared-height-trial/measure-paging.py \
  /tmp/shared-height-before-release/Sokosumi.app \
  /tmp/shared-height-after-release/Sokosumi.app /tmp/shared-height-paging-results
```

Run with an awake, unlocked display and no concurrent builds/tests. The runner
uses five older pages per process; each successful process exits before the next
starts. It expects six requests, 600 final messages, five publications for counts
200 through 600, and identical fixture fingerprints. New timings will vary with
the machine/environment; the original results remain in `measurements.json`.

For offline preparation only, pass `--prepare-only` to the build script. It copies
and instruments the historical source without invoking Xcode or running the app.

## Replay native correctness checks

Build Debug through the same adapter, sequentially for each variant:

```bash
python3 apps/apple/prototypes/lazy-prepend/shared-height-trial/build-paging.py \
  /tmp/shared-height-before /tmp/shared-height-before-debug --configuration Debug
```

Run the workspace's focused suites using that build before building the other
variant; shared Derived Data can hold only the most recently built variant.
If you selected `REPRO_DERIVED_DATA` when building, add
`-derivedDataPath "$REPRO_DERIVED_DATA"` to the test command.

```bash
repro_checks=(
  -only-testing:SokosumiTests/ExpandableMessageBodyTests
  -only-testing:SokosumiTests/TranscriptScrollEdgesTests
  -only-testing:SokosumiTests/NativeWindowTests/TranscriptScrollingTests
  -only-testing:SokosumiTests/NativeWindowTests/RoomOlderPageTests
  -only-testing:SokosumiTests/NativeWindowTests/TranscriptContentGrowthTests
  -only-testing:SokosumiTests/NativeWindowTests/ThreadPaginationTests
  -only-testing:SokosumiTests/NativeWindowTests/ThreadScrollNearTopTests
  -only-testing:SokosumiTests/NativeWindowTests/MessageBodyPresentationTests
  -only-testing:SokosumiTests/NativeWindowTests/MessageContextMenuTests
  -only-testing:SokosumiTests/NativeWindowTests/MessageHoverDelayTests
)
xcodebuild test-without-building \
  -workspace /tmp/shared-height-before-debug/AppleSource/Sokosumi.xcworkspace \
  -scheme Sokosumi -configuration Debug -destination 'platform=macOS,arch=arm64' \
  -skipPackagePluginValidation -parallel-testing-enabled NO \
  -resultBundlePath /tmp/shared-height-before-checks.xcresult "${repro_checks[@]}"
```

Repeat the Debug build and test command with `after` paths. To repeat the broader
app/package gate, replace the `repro_checks` arguments with
`-skip-testing:SokosumiTests/NativeWindowTests` and use a fresh result-bundle path.
Reading-position restoration here means preserving visible rows after an older
page lands, rather than adding persistence across room switches.

This archive retains source, protocol, and raw/result summaries. Large `.app`,
Derived Data, `.trace`, and `.xcresult` bundles are local outputs, not repo inputs.

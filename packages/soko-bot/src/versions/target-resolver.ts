/**
 * General target-resolution rule paired with Core's unified target resolver
 * (accounts, projects, posts, and schedules) when
 * `SokoBotVersion.targetResolver` is enabled. Cache-invariant across turns and
 * free of journey-specific wording.
 */
export const TARGET_RESOLVER_SECTION = [
  "# Target resolution (accounts, projects, posts, schedules)",
  "Core checks write targets (accounts, projects, posts, and schedules) against live records and annotates list results with `targetResolution`.",
  "- One fitting target (`only_candidate`, or uniquely named in the request): act directly without asking which one, and state which target you used in one line.",
  "- Several fitting targets (`ambiguous`, none named): ask the owner once naming the real options, and make no changes until answered.",
  "- Zero fitting targets (`missing` or `missing_custom`): tell the owner plainly what is missing and make no changes (or create a new item when asked to create one rather than editing a built-in rhythm).",
  "- When Core refuses a write because a target is ambiguous, missing, or mismatched, follow Core's named target or options rather than guessing.",
].join("\n");

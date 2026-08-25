# Maintaining the debugging-with-ably-cli Skill

## Design Philosophy

This skill teaches agents **what's possible with the Ably CLI and when to use it** — not every command, flag, and argument. The CLI is self-documenting via `--help`; agents should discover exact syntax at runtime rather than relying on this skill for command references.

The skill focuses on:
- **Categories of capability** (observe, simulate, manage, get help) — not individual commands
- **Diagnostic reasoning** (symptom → approach) — not step-by-step procedures
- **Domain knowledge agents lack** (state machines, persistence defaults, capability scoping, gotchas) — not documentation the CLI itself provides

## Maintenance Triggers

When the Ably CLI (`@ably/cli`) changes, check whether the skill needs updating:

1. **New top-level command group added** (e.g., a new product like `ably liveobjects`): Add to the relevant capability section (Observe, Simulate, or Manage) and to the diagnostic decision tree if it introduces new debugging scenarios.

2. **New capability within existing commands** (e.g., new flags, new subscribe targets): Usually NO skill update needed — agents discover flags via `--help`. Only update if the capability changes *what's possible* at a category level.

3. **Behavioral changes** (e.g., history retention changes, new connection/channel states, new error code ranges): Update the relevant reference table (connection states, channel states, key debugging facts, environment gotchas).

4. **Product changes** (e.g., new Ably product, product sunset): Update the diagnostic decision tree and capability sections.

## What NOT to Add

- Individual command syntax or flag listings — the CLI's `--help` handles this
- Step-by-step procedural workflows — research shows these degrade agent performance
- Content that duplicates the `using-ably` skill — this skill is for debugging, not building
- Full documentation of the CLI — link to `ably --help` and let agents discover

## Validation Checklist

When updating, verify:
- [ ] Skill stays under 500 lines — token budget matters, every token is loaded into agent context on every debugging session. Bloat degrades performance.
- [ ] No command syntax is hardcoded that could go stale — capability descriptions only
- [ ] Decision tree covers all Ably products the CLI supports
- [ ] State reference tables match current SDK behavior
- [ ] No overlap with `using-ably` skill content

## How to Check for CLI Changes

```bash
# Check current CLI version and command groups
ably --help

# Compare against the capability categories in SKILL.md
# Look for new top-level commands not covered

# Check subcommands for each product
ably channels --help
ably rooms --help
ably spaces --help
ably logs --help
ably bench --help
ably integrations --help
ably queues --help
ably auth --help
ably apps --help
ably support --help
```

If a new command group appears that isn't covered in the capability sections, the skill needs updating. If only flags/options change within existing commands, no update is needed.

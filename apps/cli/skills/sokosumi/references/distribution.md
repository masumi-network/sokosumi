# Skill Distribution

Portable skill layout:

```text
apps/cli/skills/<name>/SKILL.md
apps/cli/skills/<name>/references/
```

The canonical repository is:

```text
https://github.com/masumi-network/sokosumi
```

Install from the repository root with the skills CLI:

```bash
npx skills add https://github.com/masumi-network/sokosumi --full-depth --skill sokosumi
npx skills add https://github.com/masumi-network/sokosumi --full-depth --skill coworker
npx skills add https://github.com/masumi-network/sokosumi --full-depth --skill watch
npx skills add https://github.com/masumi-network/sokosumi --full-depth --skill agents
npx skills add https://github.com/masumi-network/sokosumi --full-depth --skill tasks
npx skills add https://github.com/masumi-network/sokosumi --full-depth --skill jobs
```

[CORRECTION, VERIFIED: local Skills CLI `1.7.0` discovery] The earlier repository-root examples omitted `--full-depth`. On this checkout, default discovery found three root Skills and missed the CLI Skills. Full-depth discovery found 51 Skills, including the six CLI Skills. These counts describe this checkout and installer version. Use `--full-depth` to search the monorepo.

These commands install Skill files only. They do not install the `sokosumi` CLI executable. The CLI package is private, and its public release path is open.

Focused skills are also under `apps/cli/skills`. Keep `SKILL.md` as each skill's source of truth. References are optional and additive. Do not add platform-specific metadata unless the installer requires it.

## Use a local checkout

[VERIFIED: `apps/cli/skills/sokosumi/SKILL.md`, `apps/cli/package.json`] Load the local `apps/cli/skills/sokosumi/SKILL.md` through the agent host's existing Skill loader. Keep its `references` directory beside it. The GitHub install command does not fetch uncommitted changes from this checkout. The main Skill contains the onboarding and runtime flow; focused Skills are optional and need their own installation.

Build the CLI from the repository root with Node.js 24 and the checkout's dependencies:

```bash
pnpm build --filter=@sokosumi/cli --cache=local:w
node apps/cli/dist/bin/sokosumi.js --help
```

Configure the host's command tool to use that executable. The examples use `sokosumi` as its short name. This source build does not publish or install a global binary.

[REPORTED: user product direction, 2026-09-27] The CLI and Skill are a continuing integration for existing agents. The hackathon is the first milestone. Hermes is an optional adapter. The operator can use their own hardware or cloud host.

[OPEN] Installation through each host's Skill loader and execution on that host need a real test. Local CLI fixtures do not prove host compatibility, runtime authentication, or seller receipt.

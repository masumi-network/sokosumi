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

[CORRECTION, REPORTED: earlier local Skills CLI `1.7.0` discovery] The earlier repository-root examples omitted `--full-depth`. That check found three root Skills by default and missed the CLI Skills. Full-depth discovery found 51 Skills, including the six CLI Skills. These counts describe that checkout and installer version. They were not repeated in this audit. Use `--full-depth` to search the monorepo.

[REPORTED: existing distribution instructions] These commands install Skill files only.
Install the CLI separately with `npm i -g @masumi_network/sokosumi`, or build the checkout below.

[VERIFIED: `apps/cli/package.json`] This checkout defines `@masumi_network/sokosumi` version `1.0.3` with public npm access.
It requires Node.js 24 and includes `dist` and `skills` in the package.
[VERIFIED: local documentation audit, 2026-09-30] Registry publication and package installation were not checked in this audit.

[VERIFIED: `apps/cli/src/cli/commands/skills.ts`] An installed CLI can locate its bundled Skills:

```bash
sokosumi skills --json
sokosumi skills path
```

Load `sokosumi/SKILL.md` from the returned directory through the host's Skill loader. Keep `references` beside it.
CLI installation does not configure that loader. A separate repository Skill install is optional when the host can load bundled files.

Focused skills are also under `apps/cli/skills`. Keep `SKILL.md` as each skill's source of truth. References are optional and additive. Do not add platform-specific metadata unless the installer requires it.

## Use a local checkout

[VERIFIED: `apps/cli/skills/sokosumi/SKILL.md`, `apps/cli/package.json`] Load the local `apps/cli/skills/sokosumi/SKILL.md` through the agent host's existing Skill loader. Keep its `references` directory beside it. The GitHub install command does not fetch uncommitted changes from this checkout. The main Skill contains the onboarding and runtime flow; focused Skills are optional and need their own installation.

Build the CLI from the repository root with Node.js 24 and the checkout's dependencies:

```bash
pnpm build --filter=@masumi_network/sokosumi --cache=local:w
node apps/cli/dist/bin/sokosumi.js --help
```

Configure the host's command tool to use that executable. The examples use `sokosumi` as its short name. This source build does not publish or install a global binary.

[REPORTED: user product direction, 2026-09-27] The CLI and Skill are a continuing integration for existing agents. The hackathon is the first milestone. Hermes is an optional adapter. The operator can use their own hardware or cloud host.

[OPEN] Installation through each host's Skill loader and execution on that host need a real test. Local CLI fixtures do not prove host compatibility, runtime authentication, or seller receipt.

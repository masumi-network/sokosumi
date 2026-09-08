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
npx skills add https://github.com/masumi-network/sokosumi --skill sokosumi
npx skills add https://github.com/masumi-network/sokosumi --skill hannah
npx skills add https://github.com/masumi-network/sokosumi --skill elena
npx skills add https://github.com/masumi-network/sokosumi --skill research
npx skills add https://github.com/masumi-network/sokosumi --skill market
```

Focused skills are also under `apps/cli/skills`. Keep `SKILL.md` as each skill's source of truth. References are optional and additive. Do not add platform-specific metadata unless the installer requires it.

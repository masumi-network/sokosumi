# Sokosumi Developer CLI

Package `sokosumi-cli`, binary `sokosumi`. Lives in this monorepo. Product intent is [`VISION.md`](./VISION.md). Contract is [`SPEC.md`](./SPEC.md).

## Run

From the repo root, after `pnpm install`:

```bash
pnpm sokosumi
```

Or:

```bash
pnpm --filter sokosumi-cli sokosumi
```

That opens the Ink screen. Choose browser OAuth or a user API key. OAuth opens Core `/signin`. Stored OAuth credentials and user API keys use the OS vault. Linux persistent auth needs Secret Service. If no vault is available, use `SOKOSUMI_API_KEY` or stdin for the current run. Press **r** to pick a Coworker runtime (pi-sokosumi, Eve, Hermes, OpenClaw). Connecting that runtime to a workspace (chat + Tasks) is the next slice.

Headless:

```bash
pnpm --filter sokosumi-cli sokosumi -- auth login --json
printf '%s\\n' \"$SOKOSUMI_API_KEY\" | pnpm --filter sokosumi-cli sokosumi -- auth login --api-key-stdin --json
SOKOSUMI_API_KEY=soko_preprod_... pnpm --filter sokosumi-cli sokosumi -- auth status --json
pnpm --filter sokosumi-cli sokosumi -- auth logout
```

Target-coded user API keys select mainnet or preprod locally. Legacy keys need `--preprod` or `--api-url`. API keys never go in command arguments.

Put `sokosumi` on your PATH for this machine (npm global bin, not Homebrew yet):

```bash
cd apps/cli && npm link
sokosumi
```

`pnpm link --global` needs `pnpm setup` first (`PNPM_HOME` on PATH).

npm publish of `sokosumi-cli` (then `npx sokosumi`) and a Homebrew formula wait until this package is public. Do not publish the sibling `masumi-network/sokosumi-cli` repo as this product.

Local Core (after the first-party `sokosumi_cli` client is seeded):

```bash
sokosumi --api-url http://localhost:8787
```

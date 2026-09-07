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

That opens the Ink screen. Press **l** or Enter to sign in. The browser opens Core `/signin`. After OAuth, tokens go in the macOS keychain. Press **r** to pick a Coworker runtime (pi-sokosumi, Eve, Hermes, OpenClaw). Connecting that runtime to a workspace (chat + Tasks) is the next slice.

Headless:

```bash
pnpm --filter sokosumi-cli sokosumi -- auth login --json
pnpm --filter sokosumi-cli sokosumi -- auth logout
```

Preprod:

```bash
pnpm sokosumi -- --preprod
```

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

# Sokosumi Developer CLI

Published package `sokosumi`; workspace package `sokosumi-cli`; binary `sokosumi`. Lives in this monorepo. Product intent is [`VISION.md`](./VISION.md). Contract is [`SPEC.md`](./SPEC.md).

## Run

From the repo root, after `pnpm install`:

```bash
pnpm sokosumi
```

Or:

```bash
pnpm --filter sokosumi-cli sokosumi
```

That opens the Ink screen. Choose a sign-in method with Up and Down, then press Enter. Use Esc to go back and q to quit. Choose browser OAuth or a user API key, then register a Coworker runtime (pi-sokosumi, Eve, Hermes, OpenClaw). OAuth opens Core `/signin`. Stored OAuth credentials and user API keys use the OS vault. Linux persistent auth needs Secret Service. If no vault is available, use `SOKOSUMI_API_KEY` or stdin for the current run.

Headless:

```bash
pnpm --filter sokosumi-cli sokosumi -- discover --json
pnpm --filter sokosumi-cli sokosumi -- agents list --json
pnpm --filter sokosumi-cli sokosumi -- agents hire AGENT_ID --input-json '{"query":"hello"}' --json
pnpm --filter sokosumi-cli sokosumi -- coworkers list --json
pnpm --filter sokosumi-cli sokosumi -- tasks list --json
pnpm --filter sokosumi-cli sokosumi -- jobs list --json
pnpm --filter sokosumi-cli sokosumi -- auth login --json
printf '%s\\n' "$SOKOSUMI_API_KEY" | pnpm --filter sokosumi-cli sokosumi -- auth login --api-key-stdin --json
SOKOSUMI_API_KEY=soko_preprod_... pnpm --filter sokosumi-cli sokosumi -- auth status --json
pnpm --filter sokosumi-cli sokosumi -- auth logout
```

`coworkers register` requires `--vendor-id` because Core requires the owning
vendor on create. It accepts command options for JSON fields. `tasks create`
and `tasks comment` also accept command options for JSON fields. Use
`--metadata-json` or `--metadata-file` for coworker metadata. Use
`--channel provider=value` to add coworker channel metadata. The
`coworkers api-key` command prints a masked token in text mode and returns the
one-time token only in JSON mode.

Target-coded user API keys select mainnet or preprod locally. Legacy keys need `--preprod` or `--api-url`. API keys never go in command arguments.

## Configuration

The CLI reads non-secret preferences from `~/.sokosumi/config.json`:

```json
{
  "apiUrl": "https://api.sokosumi.com",
  "authUrl": "https://api.sokosumi.com/auth",
  "webUrl": "https://sokosumi.com",
  "mainnetOAuthClientId": "public-mainnet-client",
  "preprodOAuthClientId": "public-preprod-client"
}
```

Do not put API keys, OAuth tokens, refresh tokens, or client secrets in this file. The CLI ignores those fields. The file is optional.

Configuration precedence is flags, process environment, home preferences, local `.env`, then built-in defaults. The CLI reads `.env` from the current directory and `apps/cli/.env` when present. Hosted OAuth uses the built-in first-party public client `sokosumi_cli`, so no client ID setup is required. Set `SOKOSUMI_MAINNET_OAUTH_CLIENT_ID` or `SOKOSUMI_PREPROD_OAUTH_CLIENT_ID`, or pass `--client-id`, only when you need a different registered client.

Install the published package:

```bash
npm install --global sokosumi
sokosumi auth status --json
```

Put a local build on your PATH:

```bash
cd apps/cli && npm link
sokosumi
```

`pnpm link --global` needs `pnpm setup` first (`PNPM_HOME` on PATH).

The npm package is `sokosumi`. Do not publish the sibling `masumi-network/sokosumi-cli` repository as a second product.


Local Core (after the first-party `sokosumi_cli` client is seeded):

```bash
sokosumi --api-url http://localhost:8787
```

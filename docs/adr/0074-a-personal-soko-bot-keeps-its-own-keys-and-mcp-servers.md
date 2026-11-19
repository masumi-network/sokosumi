# A personal Soko Bot keeps its own keys and MCP servers

- Status: Accepted
- Date: 2026-11-19

A Soko Bot reached outside apps only through Composio, and its sandbox started empty each turn ([ADR 0043](0043-soko-bot-runs-in-per-bot-sandboxes.md)). An owner who wanted the bot to use a service Composio does not carry, or a command-line tool with an API key, had no way to give it one. The owner can now add remote MCP servers to their own bot, save keys for it, and save setup commands that run each time its sandbox starts.

## Decisions

- **Core holds every credential.** A saved key lives in `soko_bot_secret`, an MCP server's key or OAuth tokens on its `soko_bot_mcp_server` row, each encrypted with Better Auth's `symmetricEncrypt` under a key derived from `BETTER_AUTH_SECRET` (`lib/soko-bot/secret-box.ts`). A `keyId` column records which key wrote a row. No route returns a value, and none is logged.
- **Core makes every MCP call.** The sandbox asks Core, Core adds the credential and calls the server through `ssrfSafeFetch`: `https://` only, no private addresses, no redirects. The model and the sandbox see only the result.
- **The model searches a server's tools; it is not handed all of them.** `list_mcp_tools`, `read_mcp_tool` and `run_mcp_tool` mirror the Composio tools. One model tool per MCP tool would put hundreds of descriptions into every turn.
- **The owner labels each tool.** A server's `readOnlyHint` sets the first label, but the MCP spec calls these hints untrusted, so the owner sees "Reads" or "Changes things" and can change it. A tool with no hint changes things. A tool the server adds later starts switched off.
- **An MCP result is untrusted input.** It marks the turn the way a web page does, so mail, chat posts and Composio writes stay refused. In a turn the owner typed, a write to the same server still runs when that server is the only untrusted thing the turn has read: "read the issue, then comment on it" is one request.
- **Only the owner changes the list, and only at the keyboard.** The routes need an interactive session. The bot has no tool to add a server, save a key or edit setup commands, so nothing it reads can do that either.
- **Personal bots only.** A key on a shared bot would be every member's key ([ADR 0070](0070-a-shared-soko-bots-integrations-serve-the-whole-organization.md)), and Cuso must never show Sokosumi settings ([ADR 0061](0061-cuso-is-a-shared-project-bot.md)).
- **A shell key is an environment variable, switched on per key.** The runner passes the keys the owner allowed to shell commands and replaces each value with `[secret NAME]` in whatever a command prints or a file read returns.

## Considered Options

- **Composio only.** No new surface, but the owner waits for Composio to carry each service.
- **Run MCP servers in the sandbox over stdio.** The server's key would sit in the VM, where any command can read it. Remote servers cover what owners ask for.
- **A dedicated encryption key.** Cleaner to rotate, but it has to be set in every environment before the first deploy. `keyId` leaves that door open.
- **Bind a shell key to one host through the sandbox proxy**, as the turn token is, so it never enters the VM. Stronger, but it only fits tools that send the key as a header to a known host. It is the follow-up for keys that matter most.

## Consequences

- A script in the sandbox can read a shell key and send it anywhere: the sandbox has open internet, and the redaction only covers the key as written. Owners are told this where they switch a key on. MCP credentials do not have this gap.
- Rotating `BETTER_AUTH_SECRET` makes saved keys unreadable until they are saved again, as it does for Better Auth's own encrypted tokens.
- A review flags any path that returns a secret's value, passes one to the model, or lets a shared bot, a teammate's turn or a self-started turn add a server or a key.

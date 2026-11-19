# Soko Bots run ads through the Project's ad account

- Status: Accepted
- Date: 2026-10-27

A Project connects its Google Ads and Meta Ads accounts once (`ProjectAdConnection`, [ads management](../features/ads-management.md)). A Soko Bot manages those ads only through Core's ads service, with its own ad tools in `apps/core/src/services/soko-bot-runtime/ads.ts`: `list_ad_accounts`, `list_ad_campaigns`, `find_ad_targeting`, `create_ad_campaign`, `get_ad_campaign`, `update_ad_campaign` and `delete_ad_campaign`. It never uses a Composio `googleads` or `metaads` connection of its own: `run_integration_tool` and `list_integration_tools` refuse ad toolkits and point to the Project's ad account.

**Why:** a bot-level connection was a second source of truth beside the Project's. Its raw `GOOGLEADS_*` writes skipped every guard (no paused create, no budget checks), and their receipts were always `UNKNOWN`, so the claim guard hid every reply that named a campaign the bot had made.

## Decisions

- **One connection per Project.** The bot reads and writes the ad accounts the Project connected, under the same access checks as a person (`requireAdsAccess` with `sokoBotProjectRefusal`, so a Project-scoped shared bot reaches only its own Project).
- **A new campaign starts paused.** `create_ad_campaign` always creates it `PAUSED`. After that the bot manages it fully (resume, pause, budget, edit, delete) when the owner asks.
- **One change per update call.** Google writes budget and status separately, so a combined call could fail halfway and be logged as refused after a partial write.

## Considered options

- **Keep the bot's own Composio ad connection and add guards to it.** Rejected: two connections to one ad account drift, and each guard would be written twice.
- **An approval step before every ad write.** Rejected: a paused create already keeps money from being spent without the owner, and later changes are made on the owner's request.

## Consequences

- A bot can only run ads in a Project that has connected an ad account.
- New ad capabilities are added to the ads service first, then exposed as a bot tool; never as a raw provider tool.

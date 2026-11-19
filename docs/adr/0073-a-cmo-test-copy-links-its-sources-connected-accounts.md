# A CMO test copy links its source's connected accounts

- Status: Accepted
- Date: 2026-11-19

CMO is tested every day against a real business: a tester hires a fresh Cuso for the same website, runs the whole product (research, Brand, strategy, the month, scheduling, chat) and deletes him again. That run needs the business's real connected accounts, and nobody can sign in to X, LinkedIn or TikTok for it each day. A Social connection belonged to exactly one Project: its Composio account is shared only with that Project's executor ([ADR 0042](0042-core-owned-project-social-connections.md)), and disconnecting it revokes the account at the provider. A **test copy** is now a Cuso hired as the copy of another Cuso in the same organization, whose Project uses the source's connected accounts by reference.

## Decisions

- **The mark is on the Project.** `project.testCopyOfProjectId` names the source Project, with no foreign key: the mark outlives the source and never clears, so a Project that was a test copy stays one after its Cuso is archived. `testCopyTornDownAt` records the teardown. CMO keeps no record of its own ([ADR 0062](0062-cmo-keeps-no-data-of-its-own.md)).
- **A Social connection is linked by a row of the copy's own.** Hiring a test copy creates one `project_social_connection` row per active account of the source, with the same connected account id and `executorProjectId` set to the Project the account was granted to. Every reader keeps finding connections by Project; tools run as that executor (`connectionExecutorUserId`). The source's rows are only read. A TikTok link carries no Zernio profile, so it has nothing to release.
- **A link never ends an account at the provider.** Disconnecting, closing or tearing down a row with `executorProjectId` skips the provider, whatever the source's rows say. Only the Project that connected an account may revoke it. A test copy takes no new sign-in: connecting, reconnecting and replacing are refused there.
- **Measurement is read through, not linked.** Google Analytics, Search Console and Shopify belong to the source's bot, and `soko_bot_integration` allows one row per connected account. A test copy reads the source bot's accounts while the source is live, and only with tools Composio marks read-only.
- **Ad accounts are not linked.** A link would give a test copy the tools that create, change and delete campaigns in the owner's ad account, and it could read nothing a test needs. A test copy has no ad account, and Launch is refused there.
- **A test copy never publishes.** Its posts are scheduled like any Cuso's, on the linked accounts, and Core is the only scheduler (no provider holds a scheduled post). The publisher holds back every post of a Project with the mark, and nothing that goes out at once is allowed there: approve-and-send, publish now, comment replies, ad Launch. A test copy also schedules no post sooner than 12 hours ahead, twice the time it lives, so its teardown cancels every post long before its time.
- **A test copy lives six hours at most.** One call tears it down: its unsent posts are canceled, its turns stop, its Cuso is archived, its links are disconnected and what was removed is reported. Core tears down any copy older than six hours itself, and a check route says whether anything is left.
- **Who may make one.** An owner or admin of the source's organization, or a tester on `CMO_SUBSCRIPTION_SKIP_ALLOWLIST` who belongs to it. The copy always goes into the source's organization. Whoever made a test copy may approve its strategy and tear it down, without the owner or admin role [ADR 0061](0061-cuso-is-a-shared-project-bot.md) asks for: a test copy publishes nothing and spends only Tester credits.

## Considered Options

- **Read every connection through to the source Project.** No rows to copy, but posts, the publisher, statistics and CMO's screens all find a connection by its Project; each would need the detour.
- **Add the copy's executor to the account's access list at Composio.** Changes the source's account at the provider for every test, and a failed removal would leave a test Project with access.
- **Sign in again for each copy.** Not possible unattended, and each sign-in would create a second authorization the test would have to revoke.
- **Dry-run posts.** Patrick chose real scheduling, so the test covers scheduling and deletion as an owner gets them.
- **Give the tester the admin role.** An unattended tester would then hold every right over the real Cuso as well.

## Consequences

- A source that disconnects an account while a copy is live leaves the copy's link pointing at a revoked account until the copy is torn down; its posts are held anyway.
- An account the source connects later reaches only copies hired after it.
- A test copy's Project stays in the organization after teardown, like any Cuso's Project after Start over, and never publishes again.

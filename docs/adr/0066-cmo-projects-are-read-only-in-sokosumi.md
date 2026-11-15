# CMO Projects are read-only in Sokosumi

- Status: Accepted
- Date: 2026-11-11

A Project with a Cuso looked like any other Project in Sokosumi, and any member could rename it, edit its briefing, DESIGN.md or Brand Brain, write or approve its social posts, close it, or rename, archive or reset Cuso there. Those changes bypass CMO and can break the plan Cuso runs. A **CMO Project** is now read-only in Sokosumi: Sokosumi marks it and links to CMO, and every change goes through CMO.

## Decisions

- **Only a live Cuso makes a CMO Project.** A Project is one while its Cuso is neither deleted nor archived. Start over archives Cuso, so his Project becomes an ordinary Project again and the organization can reuse its files and work.
- **Core enforces the lock, not Web.** Web hides the edit controls, but a write to a CMO Project is refused by Core with 409 `cmo_project_read_only`, so an API key, a session or another app can't route around it.
- **Only `/v1/cmo/**` or Core itself writes to a CMO Project.** Every project-scoped write route outside `/v1/cmo/**` refuses it, and so do the Soko Bot routes that change Cuso. Core's own CMO services (Cuso's runs, the month's production) write directly. Reading, pinning, hiding and linking a Task to the Project stay open, and so does chatting with Cuso in his shared room ([ADR 0061](0061-cuso-is-a-shared-project-bot.md)).
- **CMO gets its own routes for the writes it made on shared ones.** Brand Brain update, confirm and answer, strategy approve and answer, and social connection initiate and finalize live under `/v1/cmo/projects/{projectId}/…`. They reuse the same services, find Cuso by his Project for the person check, and keep the owner-or-admin approval of ADR 0061. The shared routes stay unchanged for a CMO deployed before this. Like every `/v1/cmo` route they take the person only, never a coworker acting for them, although the shared Brand Brain routes let one through.
- **`/v1/cmo/**` writes need CMO's app as well as the person.** Core reads `CMO_OAUTH_CLIENT_ID`; a write needs an OAuth token whose client is that one, else 403 `cmo_client_required`. Unset, every such write is refused. A redirect-URI match is not enough, because any signed-in person can register a client with CMO's callback. Reads stay open to members.
- **No override for Sokosumi admins.** An admin who needs to change a CMO Project uses CMO, or Start over.

## Rollout

Three changes, each safe to deploy alone: Core adds CMO's routes beside the shared ones (with this ADR); CMO calls them; then Core turns on the lock, the app check and the `cmo` flag, and Web adds the marks. Until that third change ships the lock is not enforced, and `CMO_OAUTH_CLIENT_ID` must be set in Core's production and preview environments before it does.

## Considered Options

- **Hide the controls in Web only.** Cheap, but the API and other apps would still write, and the drift this ADR stops would continue.
- **Lock every Project that ever had a Cuso.** An organization that started over would lose its Project for good.
- **Trust any first-party token on `/v1/cmo/**`.** Sokosumi's own apps hold first-party tokens too, and the lock would mean nothing for them.

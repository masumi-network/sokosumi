# Fundraising runs over the Investors contact list

- Status: Accepted
- Date: 2026-11-25

utxo AG raises money with a list of 45 investors in Contacts and a data room in Files. Patrick asked for one place to run the raise: find investors, see who on the team can introduce him, reach out, and watch who opened the deck. This record fixes the shape of that place and what it builds on.

## Decisions

- **The pipeline is the "Investors" contact list.** `/fundraising` shows every live contact on the workspace's manual list whose name is "Investors" (matched on `nameKey`). Adding an investor means adding them to that list, from Contacts, Find people, an import, or a Soko Bot; removing them from the list removes them from the raise. No second list, no sync.
- **The investor stays a Contact.** Next step, follow-up date, last touch, reply state, who on the team knows them and the interactions all come from the contact, written through the existing `PATCH /contacts/{id}`. The raise adds one row per investor, `fundraising_prospect`, keyed by `contactId`, for what only the raise cares about: stage, owner, cheque size, thesis, committed amount, notes and source. A contact without a row reads as "To research" with no owner; the row is made on first write, so a GET never writes.
- **Stages are fixed:** To research, Warm path, Reached out, Meeting, Data room, Diligence, Committed, Passed. `stageChangedAt` records the last move.
- **Data room activity is matched by email.** For each investor, the data room member in one of the workspace's rooms whose email equals one of the contact's email channels, with first and last visit, views, downloads and the file opened last. No link table: the email is the join, and a wrong email shows as "Not invited", which is also the fix.
- **Gated by organization, not by role.** `FUNDRAISING_ORGANIZATION_IDS` (Core env) lists the organizations that have Fundraising. Everyone else gets 404 from Core and a missing page from Web, so the feature has no sidebar entry and no marketing surface. Pages reach it from the Investors list and the data room through `GET /fundraising/access`.
- **Web is a thin client.** The page reads the pipeline server-side through the generated Core client, hands it to a client board as initial data, and every edit goes back through Core. Owners are organization members, checked by Core.
- **Engine, in order:** the pipeline (this record), then finding investors and portfolio research on Exa (search, and the Agent API for lists and one-click email lookup), warm paths ranked from the workspace's own contacts, interactions and familiarity scores plus LinkedIn Connections.csv imports, Gmail drafts that are never sent by Sokosumi, and Soko Bot tools for the owner. The Swarm is an optional adapter, used only when `THE_SWARM_API_KEY` is set.

## Considered options

- **A Files table or a Project as the pipeline.** Rejected: the investors already live in Contacts with their mail and meeting history; a table would copy them and drift.
- **Stage and owner as contact fields.** Rejected: `Contact.stage` is the relationship (Investor, Partner, Customer) shared by the whole CRM; a raise stage is a different axis, and owners of a raise are not owners of a contact.
- **A per-user feature flag.** Rejected: the raise is the organization's, and one env list is the smallest gate that keeps it off every other workspace.
- **The Swarm as the engine.** Patrick's call on 2026-11-25: the engine must work without it. Its Free plan has no API, and the team's network would have to be imported there first.

## Consequences

- Renaming the Investors list empties the pipeline until a list named "Investors" exists again. The page says so.
- An investor on the list without an email can never show data room activity; the sheet shows no email, which is the prompt to add one.
- The Soko Bot tools and the outreach drafts build on `fundraising.service.ts`; a second raise in the same workspace would need a list-per-raise model, which this record does not cover.

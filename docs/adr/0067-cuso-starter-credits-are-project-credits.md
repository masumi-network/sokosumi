# Cuso's starter credits are Project credits

- Status: Accepted. Amended by [ADR 0068](0068-cmo-sells-its-plans-through-polar.md): a hire no longer grants Starter credits, and Project credits also come from a CMO subscription and Project top-ups, which expire. The Starter credits granted before are Tester credits now, with their own credit bucket type.
- Date: 2026-11-11

Each hire grants 10,000 **Starter credits** ([ADR 0065](0065-a-cuso-hire-goes-into-a-new-or-an-existing-organization.md)). They went into the **Organization credit pool**, never expired, and paid for any Sokosumi work in the organization, so a hire, Start over, hire loop turned them into general credits. They are now **Project credits**: the organization still owns them, but only a charge for the hired Cuso's Project can spend them, and they end with that Cuso.

## Decisions

- **The scope is a nullable `projectId` on `CreditBucket`.** The owner stays the organization, so the owner XOR (ADR 0019) is unchanged. A bucket with a `projectId` is spendable only by a charge that carries the same `projectId`; a bucket without one stays in the pool.
- **The Project pays, not the bot.** Any charge for the Project may spend them: Cuso's turns, month review, media and agent hires, another bot's charges in that Project, and a member's own image job, Job or Task in that Project.
- **A charge's Project comes from Cuso first, then from its row.** A charge Cuso makes (turn, month review, agent hire) carries his bot's `SokoBot.projectId`, even when the row has none, such as a `hire_agent` Job without a Project. Any other charge carries its row's `projectId`. A charge with neither sees only the pool.
- **Project credits are drawn first.** A charge with a `projectId` spends that Project's buckets, then the pool in its usual expiry order. Before, the starter credits never expired and so were drawn last.
- **Seats still gate them.** They are organization credits, so an unseated member of a paid organization can't spend them, as the hire's funding gate already assumes.
- **They end with the live Cuso.** When Cuso stops being live (Start over, archive, delete), the leftover is written off in the same transaction. They never expire before that. The next hire brings its own grant.
- **Leaving CMO ends them too.** Changing a live Cuso to a version outside CMO writes off his Project credits in the same transaction. Moving between CMO versions keeps them.
- **Reactivation is allowed.** An archived Cuso can be made live again, but his written-off credits stay gone.
- **Refunds keep the scope.** A refund of a charge that drew Project credits goes back to the same Project. A charge that drew from both is refunded in two parts, one refund per scope: the Project part to the Project, the pool part to the pool.
- **A late refund is written off.** When the Project part of a refund lands after its Project stopped having a live Cuso, it is created and written off in the same transaction, so history stays intact and the now-ordinary Project can't spend it.
- **Balances follow the scope.** Sokosumi's organization balance and spendable total leave Project credits out; its bucket list shows them as their own rows, named by Project. Every gate and preflight that knows the charge's Project (turn funding, out-of-credits, Job, image and Task preflights, CMO's overview and paused state) reads Project credits plus the pool.
- **Grants already made move to their Project** if their Cuso is still live, found by the `projectId` in the grant's `referenceNote`. A grant whose Cuso is no longer live stays in the pool, so no one loses credits they already had.

## Considered Options

- **A Project as a third owner kind.** The XOR would become three-way and every owner query would change, for a rule one filter expresses.
- **Scope to Cuso's own spend only.** A member's image job for the same Business would drain the pool while the Project's credits sat unused.
- **Use only the charged row's `projectId`.** Cuso's turns carry none, and whether a hire's Job does is up to the model, so the starter credits would go mostly unspent.
- **Keep the leftover after Start over**, in the now-ordinary Project or back in the pool. Each Start over would bank another grant.
- **Scope only new grants.** Live Cusos' existing grants would stay general credits.

## Consequences

- Credits scoped to the Project narrow ADR 0065's minting loop but don't close it: every new Project still gets a fresh grant, as ADR 0065 says. Capping grants per organization or per hirer is a separate decision.
- Every caller of `prepareConsumption` and every balance read listed above must pass the charge's Project. A caller that passes none still works, but only on the pool.
- `Transaction` gets no `projectId`; a charge's Project is read through the bucket it consumed.

# 10: The subscription gate and existing Cusos

Spec: `.scratch/cmo-polar/spec.md` (SOKD-204), stories 11, 34, 45 to 47.

**What to build:** Core's CMO subscription check becomes real. A Cuso works when his Project has an active CMO subscription, or while he is still in free hiring, or while he holds Starter credits that are not used up. Otherwise he is paused, even when the Organization credit pool has credits. CMO's paused screens say why and offer the way out: subscribe, or fix the payment. Cusos hired before this change keep working on their Starter credits and are offered the checkout when those run out, or earlier if they choose.

**Blocked by:** 09 Free hiring and no Starter credits

**Status:** ready-for-agent

- [ ] The check takes the Project. Active counts, a scheduled cancel counts until the period ends, past due and ended do not.
- [ ] A Cuso in free hiring passes; a Cuso whose strategy is approved and who has no subscription does not.
- [ ] A Cuso with unspent Starter credits passes without a subscription; with them used up he does not.
- [ ] Pool credits alone never pass the check.
- [ ] Every consumer of the check follows it: execution, the execution refusal, the overview, production and Cuso's context packet.
- [ ] CMO's paused screens offer "subscribe" when there is no subscription and "fix payment" when it is past due; the subscribe action starts the plan checkout outside the hiring flow too.
- [ ] A Cuso with Starter credits left can subscribe from Settings and keeps those credits.
- [ ] Tests cover each row above through the overview route and the charging path, plus component tests for the paused screens.
- [ ] The Cuso evals are run and their table goes in the PR's Evidence (`docs/agents/evals.md`), because the context packet's paused line is now driven by the real check.

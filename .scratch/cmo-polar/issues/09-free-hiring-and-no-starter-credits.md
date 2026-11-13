# 09: Free hiring and no Starter credits

Spec: `.scratch/cmo-polar/spec.md` (SOKD-204), stories 1, 2, 13, 14. Decisions: `docs/adr/0068-cmo-sells-its-plans-through-polar.md`.

**What to build:** A hire no longer grants Starter credits. Instead, the work Cuso does himself while he is being hired (reading the site, the brand, the strategy) costs nothing, up to the checkout step. A hire succeeds in an organization with no credits. A person may have one unpaid Cuso at a time; a second hire is refused with a message that names the unpaid Cuso.

**Blocked by:** 03 Checkout is the last step of Hiring Cuso

**Status:** ready-for-agent

- [ ] Hiring Cuso grants no Starter credits; the grant function and its constant lose their callers, while the write-off helpers stay.
- [ ] The hire's funding gate keeps the Seat check and drops the balance check.
- [ ] While a Cuso has never had a CMO subscription, holds no Starter credits and has not reached the `checkout` step, charges he makes himself (turns, brand visual, homepage capture, media) are not charged. The exemption sits at the one place where a charge's Project is resolved from Cuso.
- [ ] A member's own Job, image job or Task in that Project is charged as before.
- [ ] Once the `checkout` step is reached, the exemption ends.
- [ ] A hire is refused when the hirer already has a live Cuso they hired that has never had a CMO subscription and holds no Starter credits; the refusal carries that Cuso so CMO can link to him.
- [ ] CMO's hire form shows that refusal with the link, and no longer shows the insufficient-balance top-up link for a hire.
- [ ] Cusos hired before this change are untouched: their Starter credits stay and are spent as today.
- [ ] Tests cover the free charge, the charged member job, the end of the exemption, the hire without credits, and the second-hire refusal.
- [ ] `GLOSSARY.md` and the ADRs already describe this; no doc change is needed beyond what the code makes stale.

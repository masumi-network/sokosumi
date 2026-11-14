# 03: Checkout is the last step of Hiring Cuso

Spec: `.scratch/cmo-polar/spec.md` (SOKD-204), stories 3 to 12 and 15.

**What to build:** After Launch, Hiring Cuso shows one more step: the three CMO plans with price and monthly credits, and a monthly or yearly switch. The person is sent to Polar's hosted checkout with that interval's three plans, pays, returns to CMO, sees that the payment is being confirmed, and CMO opens on the chat once the subscription is active. A person who leaves without paying lands on this step again.

**Blocked by:** 02 A paid plan order grants a month of Project credits

**Status:** done

- [x] A versioned Core route starts a plan checkout for a Cuso: it takes the interval and returns Polar's checkout URL with that interval's three plans, trial and discount codes off, the organization as customer, metadata for Project, organization, paying user and kind, and a success URL back to CMO.
- [x] Any member of the Cuso's organization may call it; it is refused when the Cuso already has a non-ended subscription, and answers 503 without Polar configuration.
- [x] Core's hiring steps gain `checkout` between `accounts` and `done`; hiring is `done` only with a CMO subscription. A Cuso already `done` before this change stays `done`.
- [x] The CMO overview's billing block carries tier, interval, status, period end, cancel-at-period-end, pending tier, available credits and whether the viewer may manage billing.
- [x] The core client snapshot is regenerated and Web typecheck passes separately.
- [x] CMO derives the new step from the overview and stores nothing of its own (ADR 0062); the step's name does not collide with the existing "Plan" step.
- [x] Returning from Polar shows a confirming state that refreshes until the subscription is active, then opens the chat.
- [x] Tests: Core route tests for the checkout route and the overview; the step derivation tests extended for the checkout step and the confirming state; a component test for the step. The design-system onboarding fixtures gain the new screen.
- [x] CMO UI follows `apps/cmo/AGENTS.md` and `apps/cmo/design-system.md`. The commit that removed the earlier mock pricing step (#6785) is prior art for the screen.

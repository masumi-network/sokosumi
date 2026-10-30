# Seat reductions apply at renewal

- Status: Accepted
- Date: 2026-10-30

Removing Seats used to change the Stripe quantity at once with `always_invoice`. Stripe put the unused amount on the customer balance, which pays later invoices, while the Organization kept the prorated credits those Seats had granted. Adding Seats and removing them again therefore yielded free credits. In the sandbox, repeating this gave 24679 extra Starter credits, about EUR 411 ex VAT at the plan rate, for the net cost of a single Seat.

A reduction now waits for the next renewal: Core attaches a Stripe subscription schedule that drops the quantity when the period ends. Nothing is refunded and no balance appears, so there is no money to get back. The Organization keeps its Seats and its credits until the renewal it has already paid up to.

Rejected: taking credits back on removal, because credits already spent cannot be recovered and spending them first keeps the hole open. Rejected: `proration_behavior: "none"` on the reduction, because the sandbox showed that Stripe still credits unused time on the last billed quantity at the next increase. Rejected: lowering the local cap today and the Stripe quantity later, because the Better Auth Stripe plugin writes local `seats` from the Stripe quantity on every update.

## Consequences

- Owners and admins see the pending count and date on the Seats card and can cancel it. Adding Seats also cancels it, after the charge succeeds.
- Seated members keep their Seat until the renewal. The newest lose it then, through the existing reconciliation on the subscription update.
- Seats added to an invoice are worth their credits whether the card or the customer balance paid. Grants look at the invoice total, not `amount_paid`. A balance left by an earlier reduction can still be spent this way, once.
- A reduction is refused while the plan is set to end, because the Seats end with it, and while another schedule manages the subscription, such as a plan change from Stripe's portal.
- Cancelling in Stripe's portal still works with a reduction pending. Stripe releases the schedule and ends the plan at the period end, so the reduction is gone: a customer who resumes the plan renews at the higher count unless they remove Seats again.
- A schedule manages the subscription until released. Core releases it when the lower count starts, and the Better Auth plugin releases it before a plan switch, which drops the pending reduction. Stripe's portal cannot update a subscription with a scheduled change.

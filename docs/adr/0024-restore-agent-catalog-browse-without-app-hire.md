# Restore Agent catalog browse without app Hire

`/agents` again shows an **Agent catalog** under the Coworker gallery so seated users can discover Cardano and x402 Agents. Catalog cards and Agent detail stay **read-only for hiring**: no Hire / Create Job, and **no price or credits** while app Hire is off. Core Hire APIs stay for Soko Bot and Coworker. Seat gate and nav label (“Agents”) stay unchanged.

**Why restore browse:** Removing the catalog (ADR-0006 / SOK-805) left no in-app overview of marketplace Agents even though Core still lists them and detail stayed reachable as an unlisted URL.

**Why keep Hire banned:** App marketplace checkout is still off. Browse is discovery only; Jobs still start outside the app marketplace.

**Why hide price:** Showing credits without Hire looks like a broken checkout. Reintroduce price only if app Hire returns.

**Why dual kind:** Catalog loaders request Cardano and x402; kind filter and badges distinguish rails. Category filters apply when Cardano is in scope; do not send Core-invalid `kind=x402` + category-only queries.

Partially supersedes ADR-0006 (browse restored; app Hire ban remains).

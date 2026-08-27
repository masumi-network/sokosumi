# Free organizations seat every member; paid ones have purchased Seats

A **free** organization (local free subscription, including new orgs and OTC orgs that never bought Stripe) seats every member: they may spend the organization credit pool and use Tasks / coworker chat. Period credits stay finite (free 250 plus any OTC/admin grants). There is no unpaid seat flag, no `seats = null` admin control, and no fake enterprise contract for this.

The first **paid** subscribe (Stripe self-serve or activating a real enterprise contract) makes Seats finite. Auto-assign Seats up to purchased capacity, **owner first**, then oldest remaining members. Overflow members become unseated (chat + read Tasks only) until an admin assigns. Paid unseated members do not get a free-tier 250 sidecar.

Rejected: unlimited as a nullable `seats` value on free that ops sets; enterprise contracts with 0 monthly credits just to unlock seats; letting free-org owners purchase seat capacity without Stripe; treating free `purchasedSeats` as 0 (that blocks everyone, including the creator).

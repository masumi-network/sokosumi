# Self-serve organization subscriptions are a shared credit pool

Self-serve organization subscription credits are an **organization credit pool**, not per-member grants (reverses SOK-536). Free: one org-owned period grant of the free monthly amount (250), every member may spend. Paid: period grant = purchased seats × credits per seat, assigned Seats spend first-come first-served. Leftover `member:` period buckets transfer into one org-owned period bucket in the same release (consume remaining, write the new bucket, keep the old rows for webhook idempotency). Empty-seat credits are not minted mid-period; the full purchased-seat grant starts on the next paid invoice.

Rejected: keep granting onto assigned members; share leftover member buckets without consolidating (billing would still look per-member); inject unused-seat credits at migration (double-grant if on-assign still fires).

# Cuso got better

Who: every member of a business whose Cuso an administrator moved onto a newer Cuso version.

1. The member opens CMO after the move.
2. A small dialog over the page says "Cuso just got better" and lists, in up to four plain lines, what the newer version changed for them (the `whatsNew` lines of each version the move skipped over, newest first).
3. "Got it" (or Escape, or a tap outside) closes it. It does not come back for that member until Cuso's next move.

Expected: shown once per member per move, never to a Cuso hired on his version, never for a move back to an older version. Data, not a list of businesses: Core reads the newest audited `SET_VERSION` admin action and the member's `cmo_upgrade_seen` row (`cmoUpgradeFor` in `cmo-upgrade.service.ts`, the overview's `upgrade`).

Missing today: nothing in the dialog links to what changed; a move onto a version without `whatsNew` lines shows no dialog.

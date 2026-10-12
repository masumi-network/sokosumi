# Temporary personal workspace on org-first membership

- Status: deprecated; [ADR-0005](../0005-optional-personal-workspace.md) stands. The overlay, `REQUIRE_PERSONAL_WORKSPACE`, and the backfill script are removed. Personal workspaces it already created stay.
- Archived: live number 0010 is retired; do not reuse it

This ADR added a temporary overlay: creating or joining an organization still landed the user in that org, and could also create a personal workspace on that path (`beforeCreateOrganization`, `beforeAddMember`, `beforeAcceptInvitation`, join-link accept, admin add-member) without clearing `preferredOrganizationId`. The overlay was off unless Core `REQUIRE_PERSONAL_WORKSPACE=true` (default `false`, matching ADR 0005). Existing org-only users were backfilled with a one-off data-migration script, which used `packages/database/.env` like Prisma CLI (not Core env). Where backfill found `preferredOrganizationId` null, it set it to an existing org membership so session create would not drop them into personal.

It contradicted ADR 0005 (personal is optional; invitees should not get a leftover personal), which stayed the long-term model. Unwinding the overlay does not delete the rows it created — jobs and tasks may already live on them.

OAuth Allow's `ensureOAuthWorkspaceAction` (PR 3885), which gives an empty inventory a personal workspace before consent, was independent of this overlay and is unaffected.

Better Auth `beforeCreateOrganization` / `beforeAcceptInvitation` / `beforeAddMember` could not share a Prisma transaction with the membership write. Personal create was fail-closed (membership did not proceed). The reverse was not: if BA then failed, a leftover personal workspace could remain. Join-link and admin add-member did share a transaction.

Rejected at the time: disable Organization on identity onboarding; create personal on Continue before the org exists; auto-delete personal after org create; change the workspace gate to require personal.

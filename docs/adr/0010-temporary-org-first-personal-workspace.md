# Temporary personal workspace on org-first membership

Creating or joining an organization still lands the user in that org. A temporary overlay can also create a personal workspace on that path (`beforeCreateOrganization`, `beforeAddMember`, `beforeAcceptInvitation`, join-link accept, admin add-member) without clearing `preferredOrganizationId`. The overlay is off unless Core `REQUIRE_PERSONAL_WORKSPACE=true` (default `false`, matching ADR 0005). Existing org-only users are backfilled the same way (`pnpm data-migration:org-only-personal-workspaces`) only when that flag is true. If backfill finds `preferredOrganizationId` null, it sets it to an existing org membership so session create does not drop them into personal.

This contradicts ADR 0005 (personal is optional; invitees should not get a leftover personal). Keep 0005 as the long-term model. Unwinding the overlay later does not delete the rows — jobs and tasks may already live on them.

OAuth Allow still uses `ensureOAuthWorkspaceAction` (PR 3885): empty inventory gets a personal workspace before consent. That path is independent of identity onboarding.

Rejected: disable Organization on identity onboarding; create personal on Continue before the org exists; auto-delete personal after org create; change the workspace gate to require personal.

# Optional personal workspace and workspace gate

Linear: [SOK-796](https://linear.app/masumi/issue/SOK-796/optional-personal-workspace-and-workspace-gate). Glossary: `CONTEXT.md`. Decision: `docs/adr/0005-optional-personal-workspace.md`.

## Requirement

A User is not required to have a personal workspace. Signup does not create one. Until they have a first workspace they cannot use the product. They get that workspace by completing identity onboarding (personal or organization) or by joining an organization via invitation or join link. Invite/join skip identity onboarding. Existing users keep their personal workspaces. `onboardingCompleted` is removed. Creating an organization does not require a verified email.

## Problem Statement

Every new account receives a personal workspace they may never use. Someone who registers through an organization invitation still gets a leftover personal workspace plus today’s intro slides and plan checkout (unless membership hides that dialog). Organic signups never choose personal vs organization after sign-up; the product assumes personal. OAuth and magic-link users cannot express that choice during the provider UI. Zero workspaces is not a supported product state, but the current fix is “always create personal,” which fights invite-only membership.

## Solution

Stop creating a personal workspace on signup. After authentication, a dedicated workspace gate owns the moment when the user cannot use the product yet: they resolve pending organization invitations and join links, or they complete identity onboarding. Identity onboarding confirms display name and lets them choose Personal or Organization. Personal creates a personal workspace. Organization runs the existing create-organization wizard; the product becomes usable as soon as the organization (and its workspace) exists. Joining an organization is itself the first-workspace decision. Later they may add the other kind. The workspace switcher lists only workspaces they have. They can never return to zero workspaces.

## User Stories

1. As a new user signing up with email and password, I want no personal workspace created for me automatically, so that I only have workspaces I chose or joined.
2. As a new user signing up with Google, I want the same post-sign-up workspace gate as password signup, so that I can choose personal vs organization even though Google cannot ask that.
3. As a new user signing up with Microsoft, I want the same workspace gate as other methods, so that my first workspace is a decision after sign-up.
4. As a new user signing up with a magic link, I want the same workspace gate, so that email-only auth still ends in a first workspace I chose or joined.
5. As a newly signed-in user with no workspace and no pending organization invitation, I want to land on the workspace gate in identity onboarding, so that I cannot use the product with zero workspaces.
6. As a user on identity onboarding, I want to confirm my display name even if a provider sent one, so that my name is intentional.
7. As a user on identity onboarding, I want my display name prefilled when the product already has one, so that I am not typing it from scratch.
8. As a magic-link user with no usable name, I want to be required to enter a display name on that screen, so that I do not enter the product unnamed.
9. As a user on identity onboarding, I want to choose Personal or Organization on the same screen as name, so that one decision creates my first workspace.
10. As a user who chooses Personal, I want a personal workspace created and the product opened, so that I can start working immediately.
11. As a user who chooses Organization, I want the existing create-organization wizard (name, URL, logo, brand guidelines, invites), so that first-org setup matches creating an org later.
12. As a user who submits organization name and URL (wizard step 0), I want the organization and its workspace created and the product to become usable, so that logo, brand, and invites do not block me.
13. As a user who closes the wizard after step 0, I want to stay in the product with that organization as my first workspace, so that I am not trapped in the wizard.
14. As a user still on logo or brand or invite steps, I want Next and Finish to work with those steps empty, so that those steps stay skippable.
15. As a user whose email is not verified, I want to create an organization during identity onboarding, so that verification is not a lock on my first workspace.
16. As a user whose email is not verified, I want to create another organization later, so that the same create-org rule applies everywhere.
17. As a user whose email is not verified, I still want the existing “verify your email” account notice, so that I can verify when I am ready.
18. As a user on identity onboarding who picked Organization by mistake before anything was created, I want to go back to Personal vs Organization, so that the choice stays reversible until a workspace exists.
19. As a user invited to an organization who signs up, I want to land on the workspace gate with that invitation, so that I finish accept or reject before I use the product.
20. As a user with a pending organization invitation, I want accepting it to make that organization my first workspace, so that I do not also get a personal workspace and do not see identity onboarding.
21. As a user with a pending join link, I want joining to behave the same as accepting an invitation, so that both org-entry paths are one rule.
22. As a user with several pending organization invitations, I want to see all of them, accept one, and enter that organization, so that I choose which org is first.
23. As a user with several pending invitations, I want to reject all of them and then see identity onboarding, so that refusing orgs lets me create my own first workspace.
24. As a user who signed up via an invite link but has not accepted or rejected yet, I want to stay on the workspace gate (not identity onboarding), so that I cannot accidentally create a personal workspace on the way to the org.
25. As a user who rejects every pending invitation, I want identity onboarding next, so that I still get a first workspace I create.
26. As an invitee who already joined an organization, I want later logins to open the product in that organization, so that I am not gated again.
27. As an existing user who already has a personal workspace, I want to keep it, so that this change does not rewrite my account.
28. As an existing user who never finished the old intro slides, I want those slides gone, so that I am not trapped in a retired dialog.
29. As a user on the free plan after I have a first workspace, I want plan checkout to remain a later overlay if it already works that way, so that monetization is not a second signup gate.
30. As an org-only user, I want the workspace switcher to omit Personal and offer Create personal workspace, so that I do not switch into a workspace that does not exist.
31. As an org-only user with a display name, I want Create personal workspace to create it and switch me there, so that adding personal later is one action.
32. As an org-only user without a display name, I want to enter a name and then get a personal workspace, so that later create still has a name.
33. As a personal-only user, I want to create an organization later with the same wizard, so that first choice is not permanent.
34. As a user with both a personal workspace and organizations, I want the switcher to list all of them, so that I can move between identities I actually have.
35. As a user with at least one organization workspace, I want to delete my personal workspace, so that I can become org-only on purpose.
36. As a user whose only workspace is personal, I want delete personal to be refused, so that I cannot return to zero workspaces.
37. As an organization owner, I want existing organization-delete rules to still apply, and I want delete refused when that organization is my last workspace, so that I cannot go to zero that way either.
38. As a user on the workspace gate, I want no app chrome, so that I cannot sneak into tasks, chat, or billing.
39. As a user on the workspace gate, I want leaving to mean sign out or finish, so that the gate is not dismissible.
40. As a signed-in user who bookmarks an app URL with zero workspaces, I want to be sent back to the workspace gate, so that deep links cannot bypass the hard gate.
41. As a user who signs out mid identity onboarding and signs in again, I want to resume the workspace gate, so that incomplete onboarding is durable.
42. As a user invited to a chat room as a guest (not an organization invitation), I want to still complete a first workspace via identity onboarding (or a pending org invite if I have one), so that a room invite is not a substitute for a workspace.
43. As a user creating my first personal workspace, I want my session to use personal context, so that I land in the workspace I just created.
44. As a user whose first workspace is an organization, I want my session to use that organization, so that I do not land in a missing personal context.
45. As a teammate looking at an invitee, I want them to appear only as a member of our organization, so that we are not also paying for or seeing a personal workspace they never asked for.
46. As a platform operator, I want `onboardingCompleted` gone, so that “can use the product” is only “has a first workspace.”
47. As a developer of Core routes that used to upsert a personal workspace when organization context was null, I want a missing personal workspace to fail closed instead of creating one, so that switching or API calls cannot silently recreate personal.
48. As a user of personal-only features (personal chat rooms, coworker access on the personal workspace, vendor grants on the personal workspace), I want those features to work when I have a personal workspace and to fail clearly when I do not, so that org-only accounts are not given a fake personal context.

## Implementation Decisions

- **Personal workspace remains a type.** It is the user-owned workspace row (user id set, organization id null). It is not an Organization. At most one per user. Schema already allows a user with none.
- **Organization workspace** remains the workspace row owned by an Organization, created when the Organization is created.
- **Access rule:** a signed-in user may use the product only when they have a first workspace (a personal workspace and/or membership in an organization that has a workspace). Otherwise they are on the workspace gate. There is no `onboardingCompleted` field, session flag, or Core onboarding resource.
- **Single seam: current-user workspace inventory.** One query answers what workspaces the user has and derives the gate: `ready` if any personal workspace or org membership exists; `pending-invites` if none and they have pending organization invitations or join links; `identity-onboarding` if none and no pending org entry. Web layout and the workspace switcher consume this query. They do not invent a second source of truth.
- **Commands on that seam:** create personal workspace; create organization (existing flow, email-verify lock removed); accept invitation; join via join link; reject invitation (all, or each until none remain); delete personal workspace only when at least one organization workspace remains. Creating a personal workspace activates it. Accepting or joining activates that organization.
- **Stop creating personal workspaces on user create.** Every signup method (password, Google, Microsoft, magic link) must leave the user with zero personal workspaces. Lazy create on “null organization context” must stop; missing personal workspace is an error, not an upsert.
- **Workspace gate** is a dedicated authenticated route with no app chrome. It hosts pending organization invitations / join links and identity onboarding. Deep links into the app redirect here until `ready`. Sign out is the only exit besides finishing.
- **Identity onboarding first screen:** display name (always confirmed, prefilled when known, required when missing) and Personal vs Organization. Personal runs create-personal. Organization opens the existing create-organization wizard. Choice is reversible until a workspace exists.
- **Create-organization wizard** stays four steps. The organization and its workspace are created on name + URL (step 0). That is when the gate lifts to `ready`. Logo, brand guidelines, and invites stay skippable. The same wizard is used for a later additional organization.
- **Organization invitations and join links** are first-workspace decisions. They are resolved on the workspace gate before identity onboarding. Accept one → `ready` in that org, no personal workspace, no identity onboarding. Reject all → identity onboarding. Chat guest invitations are not organization invitations.
- **Workspace switcher** lists only workspaces that exist. No synthetic Personal row. If there is no personal workspace, show an explicit create action (create immediately if the user has a name; otherwise collect name; then activate). Switching must not create a workspace.
- **Last workspace cannot be deleted.** Personal delete is allowed only when an organization workspace remains. Organization delete keeps today’s owner rules and is refused when it would leave the user with zero workspaces.
- **Email verification** stays as an account notice and as provider state. It is not a condition for creating an organization, during identity onboarding or later.
- **Existing users are grandfathered.** Do not delete or hide existing personal workspaces. Remove the intro-slides + checkout signup dialog for everyone. A later free-plan checkout overlay may remain; it is not a signup gate and must not block first workspace.
- **Session context:** after create-personal, active organization is unset (personal context). After create-org, accept, or join, active organization is that organization. Org-only users must not run with “null means personal” if they have no personal workspace.
- **Web does not touch the database.** Inventory query and commands are Core (or Better Auth organization APIs already owned by Core) consumed through the generated client. Remove Core user onboarding read/write endpoints that exist only to flip `onboardingCompleted`.
- **Remove `onboardingCompleted`** from the user model, Better Auth additional fields, signup payloads, session user type, and any “show onboarding” helper. A data migration may drop the column after code no longer reads it.
- **Signup bonus, Stripe customer, and user-level metadata** that today hang off user create (not the personal workspace row) stay on the user unless a later spec moves them. Do not invent a personal workspace just to attach those.

## Testing Decisions

- Test external behaviour of the workspace inventory seam, not which helper called which repository.
- **Gate table (required):** personal present / org memberships / pending org invites → `ready` | `pending-invites` | `identity-onboarding`. Cover the empty-empty-empty, empty-empty-some, any-workspace-ignores-invites, and membership-without-personal cases.
- **User create:** every signup method leaves zero personal workspaces. Regression against the old “create user then upsert personal” behaviour.
- **Commands:** create personal (with and without existing name); create organization while email is unverified; accept invitation does not create personal; reject all then identity onboarding; delete personal allowed only with an org remaining; delete last workspace refused.
- **Null organization context** does not create a personal workspace. Personal-only Core routes that need a personal workspace fail closed when it is missing.
- **Web:** signed-in user with zero workspaces never sees app chrome; invite accept lands in the org; switcher omits Personal until created; existing users with a personal workspace still see it.
- Prior art: current onboarding-visibility tests (replace with gate-table tests); Core auth user-create hook tests; organization create / invitation accept tests; workspace switcher client tests; workspace middleware / require-workspace-context tests.

## Out of Scope

- Turning personal workspaces into one-person Organizations.
- Migrating or deleting personal workspaces for existing users.
- Redesigning billing, credits, seats, or signup bonus beyond “do not require a personal workspace to exist.”
- Killing email verification as a product (notices and verify emails stay).
- Changing chat guest invitation membership rules, except that a guest invite is not a first workspace.
- New profile or avatar wizards on the personal path.
- Making logo, brand, or invites required before the product is usable.
- Multi-personal-workspaces or renaming the personal workspace as a first-class named entity.
- Mobile-native clients beyond the web app gate.

## Further Notes

- Vocabulary: Personal workspace, Organization workspace, First workspace, Identity onboarding, Workspace gate — as in `CONTEXT.md`. Do not revive `onboardingCompleted` under another name.
- Tracer-bullet children of [SOK-796](https://linear.app/masumi/issue/SOK-796/optional-personal-workspace-and-workspace-gate):
  - [SOK-797](https://linear.app/masumi/issue/SOK-797) inventory + gate shell
  - [SOK-798](https://linear.app/masumi/issue/SOK-798) identity — name + personal (blocked by 797)
  - [SOK-799](https://linear.app/masumi/issue/SOK-799) retire `onboardingCompleted` (blocked by 797)
  - [SOK-800](https://linear.app/masumi/issue/SOK-800) invite/join as first workspace (blocked by 798)
  - [SOK-801](https://linear.app/masumi/issue/SOK-801) identity — org wizard (blocked by 798)
  - [SOK-802](https://linear.app/masumi/issue/SOK-802) cut over: stop auto-create (blocked by 798, 800, 801)
  - [SOK-804](https://linear.app/masumi/issue/SOK-804) switcher + later personal + last-workspace delete (blocked by 802)

- **Merge:** stack PRs for work; merge in order as each is green. Do not hold all seven for one end merge. 797 first (safe alone). 799 anytime after 797. 798 then 800/801. **802 + 804 same release window** — after cutover the switcher still fakes Personal and upserts until 804. Do not merge 802 unless 798, 800, and 801 are on main.

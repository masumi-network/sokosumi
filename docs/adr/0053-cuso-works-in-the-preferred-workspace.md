# Cuso works in the person's preferred workspace

Hiring Cuso puts Cuso, his marketing Project and the Brand Brain into the person's preferred Workspace: the one identity onboarding just created ([ADR 0051](0051-cmo-runs-identity-onboarding-over-a-workspaces-resource.md)), or the one an existing Sokosumi user already prefers. Identity onboarding already asks who the work is for and, for an organization, its name and website, so Hiring Cuso reuses those answers instead of creating a Workspace of its own and asking again. The gate stays identity only: it never starts Cuso, and Hiring Cuso begins after it.

## Considered Options

- **Always the personal workspace.** Gives a person who chose Organization a personal workspace they never asked for, against the rule that one is created only when chosen, and leaves Cuso outside the organization they set up.
- **A new organization per business.** A second organization with the same website as the one identity onboarding just created.
- **Start Cuso from `POST /v1/users/me/workspaces`.** One submit instead of two, but it ties a CMO product step to the identity resource that Web uses too.

## Consequences

- The start form names the Workspace it prefilled from, and Core hires into that one after checking membership, so a preferred Workspace changed in another tab does not move Cuso.
- The start form prefills the website from an organization workspace's stored website and stays editable; what is submitted becomes Cuso's Project website and leaves the organization's untouched. A personal workspace has none, so the person types it.
- The business name is the organization's name, or the website's host for a personal workspace.
- Cuso stays one per person. Two members of one organization each hire their own Cuso there, with two Brand Brains and two daily runs; sharing one Cuso per Workspace changes chat ownership and autonomy and is a separate decision.
- Any member may hire Cuso into an organization, and he runs on the organization's plan and credits; the start form says so before the person starts. An existing user whose preferred Workspace is a team organization therefore hires into that team without a picker; a picker follows if people ask for one.
- Links from CMO into Sokosumi (connecting a Social channel) open in whichever Workspace is active in Web, because Web has no link that selects an organization. For a Cuso in an organization the person may first have to switch Web to it; a link that selects the organization is a follow-up.

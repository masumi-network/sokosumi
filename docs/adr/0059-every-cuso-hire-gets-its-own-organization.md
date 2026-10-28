# Every Cuso hire gets its own organization

Cuso works for one person at a time, so CMO no longer asks where it will be used. Hiring Cuso creates a new organization named after the business's website host, owned by the person and made preferred, and puts Cuso, his marketing Project and the Brand Brain there. `POST /v1/cmo/onboarding` takes only the website and the goal; Core creates the organization through the same helper `POST /v1/users/me/workspaces` uses, so organization hooks, the free plan and the organization limit all apply. This supersedes [ADR 0053](superseded/cuso-works-in-the-preferred-workspace.md).

## Considered Options

- **Keep the workspace gate (ADR 0053).** Asks "Just me or my organization" before a product that only serves one person, and puts Cuso into whatever Workspace a returning Sokosumi user prefers, team organizations included.
- **The personal workspace.** No new organization, but Cuso's credits, Files and social connections mix with the person's own Sokosumi work.

## Consequences

- CMO drops the workspace gate, the organization form and the pending-invitations screen from [ADR 0051](0051-cmo-runs-identity-onboarding-over-a-workspaces-resource.md). The name step stays: a person whose sign-up gave no valid first and last name still gives one first.
- A returning Sokosumi user also gets a new organization; their existing workspaces are untouched.
- Cuso runs on the new organization's plan and credits, starting with the free plan Core seeds for every new organization.
- The business name is the website's host, cut to the organization name's 50 characters. Renaming it is a Sokosumi organization setting.
- A hire that fails after the organization exists leaves it behind, empty. A retry takes an organization of the same name that the person alone owns and that has no Projects, instead of creating a second one. Deleting it would run through billing and membership hooks, so Core does not.

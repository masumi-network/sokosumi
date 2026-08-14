# Optional personal workspace; first workspace from the workspace gate

A User is no longer guaranteed a personal workspace. Signup does not create one. The product is unusable until the user has a **first workspace**: they create a personal workspace, they create an organization (and its workspace), or they join an organization via invitation or join link.

**Why optional (not deleted):** personal remains a first-class user-owned workspace. Invitees should not get a leftover personal workspace they never asked for. Organic users still choose personal vs organization after signup.

**Why a hard workspace gate (not an in-app dialog):** zero workspaces is not a product state. A dedicated route owns pending invitations/join links and identity onboarding. Access is “has a first workspace,” not a parallel `onboardingCompleted` flag (that flag is removed).

**Why invite/join skip identity onboarding:** joining the organization *is* the first-workspace decision. Rejecting every pending invite falls through to identity onboarding.

**Why org create does not require verified email:** verification stays an account notice, not a lock on creating or joining workspaces.

**Rejected:** every workspace is an Organization (“personal” as a one-person org); auto-create personal then hide it; keep intro slides + checkout as the signup gate; keep `onboardingCompleted` as a second source of truth.

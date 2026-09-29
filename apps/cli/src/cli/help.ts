import { formatCliCommandHelpLines } from "./commands/discover.js";
import type { CliOptions, ValueOptionName } from "./index.js";
import { CLI_VERSION } from "./metadata.js";

export const GLOBAL_VALUE_OPTIONS = [
  "api-url",
  "auth-url",
  "client-id",
  "oauth-port",
  "oauth-timeout-ms",
] as const satisfies readonly ValueOptionName[];

const GLOBAL_VALUE_PLACEHOLDERS: Record<
  (typeof GLOBAL_VALUE_OPTIONS)[number],
  string
> = {
  "api-url": "URL",
  "auth-url": "URL",
  "client-id": "ID",
  "oauth-port": "PORT",
  "oauth-timeout-ms": "MS",
};

export const GLOBAL_BOOLEAN_FLAG_BY_TOKEN = {
  "--preprod": "preprod",
  "--api-key-stdin": "api-key-stdin",
  "--json": "json",
  "-h": "help",
  "--help": "help",
  "-v": "version",
  "--version": "version",
} as const satisfies Record<string, keyof CliOptions>;

function formatGlobalOptionHelp(): string[] {
  const booleanLines: string[] = [];
  const seen = new Set<string>();
  for (const [token, option] of Object.entries(GLOBAL_BOOLEAN_FLAG_BY_TOKEN)) {
    if (seen.has(option)) {
      booleanLines[booleanLines.length - 1] += `, ${token}`;
      continue;
    }
    seen.add(option);
    booleanLines.push(token);
  }
  return [
    ...GLOBAL_VALUE_OPTIONS.map(
      (name) => `--${name} ${GLOBAL_VALUE_PLACEHOLDERS[name]}`,
    ),
    ...booleanLines,
  ];
}

export function formatHelpText(): string {
  return `Sokosumi CLI v${CLI_VERSION}

Usage:
  sokosumi
${formatCliCommandHelpLines()}

Empty argv opens the TUI. Use arrows, then Enter. Press Esc to go back.

Global options:
${formatGlobalOptionHelp()
  .map((line) => `  ${line}`)
  .join("\n")}

Account checks:
  auth whoami asks Core for the signed-in email and platform role. auth status shows authentication state.
  Before switching browser accounts, clear SOKOSUMI_API_KEY and SOKOSUMI_AUTH_TOKEN from the shell. They override saved OAuth credentials.
  Sign in as the intended account in the browser, run auth login, then auth whoami.
  auth logout clears local credentials; it does not switch the browser account.

Skills for agents:
  sokosumi skills lists the SKILL.md guides bundled with this package. sokosumi skills path prints their directory.
  Point your agent at the "sokosumi" skill first; it walks through login, Coworker setup, and running Tasks.

Developer setup on Preprod:
  1. Create your Vendor: sokosumi --preprod vendors create --name NAME --slug SLUG
  2. Give its ID and your final Coworker name to the organizer. Ask for the Coworker ID.
  3. Connect: sokosumi --preprod coworkers connect COWORKER_ID --vendor-id VENDOR_ID --workspace-id ORGANIZATION_ID
  4. Create the runtime key: sokosumi --preprod coworkers api-key COWORKER_ID --json
  5. Before organization Tasks, check Seat eligibility: sokosumi --preprod workspaces check ORGANIZATION_ID
  Membership and Coworker access do not prove Task Seat eligibility. This check does not confirm credits or runtime setup.

Organizer setup on Preprod (platform admin):
  Select an organization Workspace. Workspace creation and email invitations remain in Sokosumi Web.
  For an existing Preprod account, use the selected Workspace slug:
  sokosumi --preprod admin members WORKSPACE_SLUG
  sokosumi --preprod admin add-member WORKSPACE_SLUG --email EMAIL
  sokosumi --preprod admin assign-seat WORKSPACE_SLUG --email EMAIL
  Admin commands require a live platform-admin identity. Core authorizes each request.
  Free Workspace members need no Seat assignment. Paid Seat capacity is managed separately in Web billing.
  Member lookup uses the account's exact email. It does not select the developer's Vendor.
  Ask each developer for their Vendor ID and final Coworker name.
  Verify your account: sokosumi --preprod auth whoami
  Provision checks the live platform role. Core still authorizes creation.
  sokosumi --preprod coworkers provision --vendor-id VENDOR_ID --name NAME --capability tasks
  Give the returned Coworker ID and Vendor ID to that developer, plus the selected organization ID and Workspace slug.
  Vendor admins manage that Vendor's Coworkers. Provisioning does not assign a Coworker to a person by email.

Organization Tasks:
  Add --organization-slug WORKSPACE_SLUG to any tasks command to select that organization.
  Core checks Workspace membership and Task permissions. The selected network stays unchanged.
  Without this flag, Core uses the credential's default context. OAuth defaults to the personal Workspace.
  Example: sokosumi --preprod tasks create --organization-slug WORKSPACE_SLUG --coworker-id ID --description TEXT --status READY

Agent runtime tools on Preprod:
  runtime key-import requires --coworker-id ID --api-key-stdin and stores a verified key in the OS vault.
  runtime start, complete, and run require --coworker-id ID --organization-id ID. They use that Coworker's stored key or --api-key-stdin.
  Runtime commands do not read developer credentials or target configuration.
  runtime start returns the Task after moving it to RUNNING. Your existing agent performs the work.
  runtime complete requires --result-file FILE containing the finished answer as UTF-8 text, at most 1 MiB.
  runtime receipt requires --coworker-id ID with TASK_ID. It proves the seller receipt: settled is true only when the Masumi payment settled on-chain (onChainState Withdrawn, or DisputedWithdrawn with a seller payout). It also returns the settlement txHash.
  Use --json for tools. Run one executor per Task; inspect state before any retry.

Optional Hermes runner:
  runtime run requires --hermes-home EXISTING_PROFILE_DIR --runtime-directory ABSOLUTE_DIR.
  Optional overrides: --provider NAME --model NAME --hermes-path EXECUTABLE --timeout-ms MS (default: 300000).
  Run one READY Task using the developer's configured Hermes profile.
  The adapter preserves the profile's tools and model. It does not poll for more work.
`;
}

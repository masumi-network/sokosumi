import {
  type AdminWorkspace,
  type AdminWorkspaceMember,
  normalizeAdminEmail,
  validateAdminPathSegment,
} from "../../api/models/admin-workspace.js";
import { hasPlatformAdminRole } from "../../api/models/user-identity.js";
import {
  addAdminWorkspaceMember,
  assignAdminWorkspaceSeat,
  fetchAdminWorkspace,
  fetchAdminWorkspaceMembers,
  findAdminUserByEmail,
} from "../../api/services/admin-workspace-service.js";
import { fetchUserIdentity } from "../../api/services/user-identity-service.js";
import type { CliTargetConfig } from "../../auth/config.js";
import {
  type CommandContext,
  type CommandOptions,
  optionString,
  writeJson,
  writeText,
} from "./command-helpers.js";

export interface AdminCommandContext extends CommandContext {
  target?: CliTargetConfig["target"];
  subcommand?: string;
  positionalId?: string;
  options?: CommandOptions;
}

const ADMIN_COMMANDS = ["members", "add-member", "assign-seat"] as const;
const ADMIN_OPTIONS = new Set([
  "json",
  "preprod",
  "api-url",
  "auth-url",
  "client-id",
  "email",
]);

export function validateAdminCommand({
  target,
  subcommand,
  positionalId,
  options,
}: Pick<
  AdminCommandContext,
  "target" | "subcommand" | "positionalId" | "options"
>): { slug: string; email?: string } {
  if (target !== "preprod") {
    throw new Error("Admin onboarding is Preprod only. Select --preprod.");
  }
  if (!ADMIN_COMMANDS.some((command) => command === subcommand)) {
    throw new Error(
      "Usage: sokosumi admin members|add-member|assign-seat WORKSPACE_SLUG [--email EMAIL]",
    );
  }
  for (const name of Object.keys(options ?? {})) {
    if (!ADMIN_OPTIONS.has(name)) {
      throw new Error(`Option --${name} is not supported by admin onboarding`);
    }
  }
  const slug = validateAdminPathSegment(positionalId ?? "", "Workspace slug");
  const emailInput = optionString(options, "email");
  if (subcommand === "members") {
    if (emailInput !== undefined) {
      throw new Error("admin members does not accept --email");
    }
    return { slug };
  }
  if (emailInput === undefined) {
    throw new Error(`--email is required for admin ${subcommand}`);
  }
  return { slug, email: normalizeAdminEmail(emailInput) };
}

function eligible(
  workspace: AdminWorkspace,
  member: AdminWorkspaceMember,
): boolean {
  return workspace.plan === "free" || member.seatAssignedAt !== null;
}

function selectMember(
  members: AdminWorkspaceMember[],
  email: string,
): AdminWorkspaceMember | undefined {
  const matches = members.filter(
    (member) => normalizeAdminEmail(member.user.email) === email,
  );
  if (matches.length > 1) {
    throw new Error(
      "Multiple Workspace members match that email. Inspect membership before retrying.",
    );
  }
  return matches[0];
}

export async function runAdminCommand(
  context: AdminCommandContext,
): Promise<void> {
  const { client, stdout, json = false, subcommand } = context;
  const { slug, email } = validateAdminCommand(context);
  const timeout = AbortSignal.timeout(30_000);
  const signal = context.signal
    ? AbortSignal.any([context.signal, timeout])
    : timeout;
  signal.throwIfAborted();
  const user = await fetchUserIdentity(client, signal);
  if (!hasPlatformAdminRole(user)) {
    throw new Error(
      `Admin onboarding requires a Sokosumi platform admin. Signed in as ${user.email}, platform role: ${user.platformRole}. Check the browser account, then run sokosumi --preprod auth login.`,
    );
  }
  const workspace = await fetchAdminWorkspace(client, slug, signal);
  const members = await fetchAdminWorkspaceMembers(client, slug, signal);
  if (members.some((member) => member.organizationId !== workspace.id)) {
    throw new Error(
      "Core returned members from a different organization. No change was requested.",
    );
  }

  if (subcommand === "members") {
    const result = {
      workspace,
      members: members.map((member) => ({
        ...member,
        taskSeatEligible: eligible(workspace, member),
      })),
    };
    if (json) writeJson(stdout, result);
    else {
      writeText(stdout, [
        `${workspace.name} [${workspace.id}]`,
        `Workspace slug: ${workspace.slug}`,
        `Plan: ${workspace.plan}`,
        workspace.plan === "free"
          ? "Every member meets the free plan's Seat policy. No Seat assignment is needed."
          : `Seats: ${workspace.seatSummary.assignedCount} assigned, ${workspace.seatSummary.purchasedSeats} purchased, ${workspace.seatSummary.unusedSeats} available.`,
        ...result.members.map(
          (member) =>
            `${member.user.email} [${member.id}] | ${member.role} | Task Seat eligible: ${member.taskSeatEligible}`,
        ),
        "Seat eligibility does not confirm credits or runtime setup.",
      ]);
    }
    return;
  }

  // Validation above requires email for either mutation command.
  if (!email) throw new Error("--email is required");
  let member = selectMember(members, email);
  if (subcommand === "add-member") {
    const created = member === undefined;
    if (!member) {
      const developer = await findAdminUserByEmail(client, email, signal);
      signal.throwIfAborted();
      member = await addAdminWorkspaceMember(
        client,
        slug,
        workspace.id,
        developer,
        signal,
      );
    }
    const taskSeatEligible = eligible(workspace, member);
    if (json)
      writeJson(stdout, {
        organizationId: workspace.id,
        workspaceSlug: slug,
        member,
        created,
        taskSeatEligible,
      });
    else
      writeText(stdout, [
        `${created ? "Added" : "Already a member:"} ${member.user.email} [${member.id}] in ${workspace.name} [${workspace.id}].`,
        `Task Seat eligible: ${taskSeatEligible}`,
        taskSeatEligible
          ? "Next: provision a Coworker under the developer's Vendor, then give them its ID and this organization ID."
          : "Next: run sokosumi --preprod admin assign-seat WORKSPACE_SLUG --email EMAIL with this Workspace slug and developer email.",
        "Workspace membership does not grant Vendor access or create a Coworker.",
      ]);
    return;
  }

  if (!member) {
    throw new Error(
      "The developer is not a member of this Workspace. Run admin add-member first.",
    );
  }
  let seatAssignment: "not-required" | "existing" | "assigned";
  if (workspace.plan === "free") seatAssignment = "not-required";
  else if (member.seatAssignedAt !== null) seatAssignment = "existing";
  else {
    if (workspace.seatSummary.unusedSeats < 1) {
      throw new Error(
        "No unused Seats are available. An organization owner or admin must review Seat capacity in Web billing. Coworker provisioning and connection can continue.",
      );
    }
    signal.throwIfAborted();
    const assignment = await assignAdminWorkspaceSeat(
      client,
      slug,
      member.id,
      signal,
    );
    member = { ...member, seatAssignedAt: assignment.seatAssignedAt };
    seatAssignment = "assigned";
  }
  const result = {
    organizationId: workspace.id,
    workspaceSlug: slug,
    member,
    seatAssignment,
    taskSeatEligible: true,
  };
  if (json) writeJson(stdout, result);
  else
    writeText(stdout, [
      `${member.user.email} [${member.id}] meets the Seat policy in ${workspace.name} [${workspace.id}].`,
      seatAssignment === "not-required"
        ? "Free plan: no Seat assignment is needed."
        : `Seat assignment: ${seatAssignment}.`,
      "Next: provision a Coworker under the developer's Vendor, then give them its ID and this organization ID.",
      "Seat eligibility does not confirm credits or runtime setup.",
    ]);
}

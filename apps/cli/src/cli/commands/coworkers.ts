import type { CoworkerWorkspaceAccess } from "../../api/models/coworker-workspace-access.js";
import { hasPlatformAdminRole } from "../../api/models/user-identity.js";
import {
  createCoworker,
  createCoworkerApiKey,
  fetchCoworker,
  fetchCoworkers,
  fetchCurrentCoworker,
  grantCoworkerWorkspaceAccess,
  updateCoworker,
} from "../../api/services/coworker-service.js";
import {
  ensurePersonalWorkspace,
  verifyPersonalWorkspace,
} from "../../api/services/personal-workspace-service.js";
import { fetchUserIdentity } from "../../api/services/user-identity-service.js";
import { fetchVendorMemberships } from "../../api/services/vendor-service.js";
import type { CliTargetConfig } from "../../auth/config.js";
import { selectCoworkerWorkspaceTarget } from "../coworker-workspace-target.js";
import { CliError, classifyError } from "../errors.js";
import {
  requireAdministeredVendorForRegistration,
  requirePreprodCoworkerRegistration,
} from "../registration-authority.js";
import {
  applyListFilters,
  type CommandContext,
  type CommandOptions,
  maskSecret,
  mergeChannels,
  normalizeCapabilities,
  option,
  optionBoolean,
  optionString,
  parseChannels,
  parseInteger,
  parsePositiveInteger,
  readOptionalJsonObject,
  record,
  truncate,
  writeJson,
  writeText,
} from "./command-helpers.js";

const PENDING_KEY_GUIDANCE =
  "A runtime key identifies this Coworker. It does not grant access to the pending Workspace.";
const TERMINAL_ACCESS_MESSAGE = "Cannot re-request after deny/revoke";

export interface CoworkersCommandContext extends CommandContext {
  target?: CliTargetConfig["target"];
  subcommand?: string;
  positionalId?: string;
  options?: CommandOptions;
}

function rethrowCoworkerCreationError(
  error: unknown,
  vendorId: string,
  organizationId = "ORGANIZATION_ID",
): never {
  const failure = error instanceof Error ? error : new Error(String(error));
  const status = "status" in failure ? failure.status : undefined;
  if (status === 403) {
    const body = "body" in failure ? record(failure.body) : {};
    const guidance = [
      "Check the signed-in Preprod account with `sokosumi --preprod auth whoami --json`.",
    ];
    if (body.message === "Admin access required") {
      guidance.push(
        "Core denied private Coworker creation. Ask the organizer or a Sokosumi platform admin to check Vendor authority and deployed self-service support.",
        `Send Vendor ${vendorId} and your final Coworker name to the organizer.`,
        `After you receive a Coworker ID, run \`sokosumi --preprod coworkers connect COWORKER_ID --vendor-id ${vendorId} --workspace-id ${organizationId}\`.`,
        "Then create its runtime key with `sokosumi --preprod coworkers api-key COWORKER_ID --json`.",
      );
    }
    failure.message = `${failure.message}\n${guidance.join("\n")}`;
  } else if (typeof status !== "number" || status < 400 || status >= 500) {
    failure.message +=
      " Creation may have succeeded. Inspect `sokosumi --preprod coworkers list --scope all` before retrying.";
  }
  throw failure;
}

function rethrowWorkspaceAccessError(
  error: unknown,
  coworkerId: string,
): never {
  if (
    error instanceof Error &&
    "status" in error &&
    error.status === 400 &&
    "body" in error &&
    record(error.body).message === TERMINAL_ACCESS_MESSAGE
  )
    throw new Error(
      `Coworker ${coworkerId} Workspace access was denied or revoked. Keep this Coworker ID. Ask a Workspace owner or admin to restore access. Do not register again.`,
    );
  throw error;
}

async function buildPayload(
  options: CommandOptions | undefined,
  command: "register" | "provision" | "update",
): Promise<Record<string, unknown>> {
  const update = command === "update";
  const metadata = await readOptionalJsonObject(
    option(options, "metadata-json"),
    option(options, "metadata-file"),
    "metadata",
  );
  const channels = parseChannels(option(options, "channel"));
  const payload: Record<string, unknown> = {};
  const vendorId = optionString(options, "vendor-id")?.trim();
  if (update && vendorId !== undefined)
    throw new Error(
      "--vendor-id is only supported for `coworkers register` or `coworkers provision`",
    );
  if (!update) {
    if (!vendorId) {
      throw new Error(
        command === "provision"
          ? "vendor id is required for `coworkers provision`. Ask the developer for their Vendor ID."
          : "vendor id is required for `coworkers register` (create one first with `sokosumi vendors create --name NAME --slug SLUG`)",
      );
    }
    payload.vendorId = vendorId;
  }
  const values: [string, string][] = [
    ["name", "name"],
    ["caption", "caption"],
    ["company", "company"],
    ["companyLogo", "company-logo"],
    ["url", "url"],
    ["baseURL", "base-url"],
    ["description", "description"],
    ["image", "image"],
  ];
  for (const [key, name] of values) {
    const value = optionString(options, name);
    if (value !== undefined && (!update || key !== "name" || value !== ""))
      payload[key] = value;
  }
  const priority = parseInteger(option(options, "priority"), "--priority");
  if (priority !== undefined) payload.priority = priority;
  const rawCapabilities = option(options, "capability");
  if (rawCapabilities !== undefined)
    payload.capabilities = normalizeCapabilities(rawCapabilities);
  const mergedMetadata = mergeChannels(metadata, channels);
  if (mergedMetadata !== undefined) payload.metadata = mergedMetadata;
  if (!update && (typeof payload.name !== "string" || !payload.name.trim())) {
    throw new Error("name is required");
  }
  return payload;
}

function printCoworkerList(
  stdout: CommandContext["stdout"],
  coworkers: readonly unknown[],
): void {
  if (!coworkers.length) {
    writeText(stdout, ["No coworkers matched."]);
    return;
  }
  const lines = ["Coworkers"];
  for (const raw of coworkers) {
    const coworker = record(raw);
    const capabilities =
      Array.isArray(coworker.capabilities) && coworker.capabilities.length
        ? coworker.capabilities.join(", ")
        : "none";
    lines.push(
      `${String(coworker.name || "Unnamed Coworker")} [${String(coworker.id || "unknown")}]`,
    );
    lines.push(`  capabilities: ${capabilities}`);
    if (coworker.company) lines.push(`  company: ${String(coworker.company)}`);
    if (coworker.baseURL) lines.push(`  baseURL: ${String(coworker.baseURL)}`);
    const channels = record(coworker.metadata).channels;
    if (channels && typeof channels === "object" && !Array.isArray(channels)) {
      const values = Object.entries(channels)
        .map(([provider, value]) => `${provider}=${String(value)}`)
        .join(", ");
      if (values) lines.push(`  channels: ${values}`);
    }
    if (coworker.description)
      lines.push(`  description: ${truncate(coworker.description, 140)}`);
  }
  writeText(stdout, lines);
}

function printCoworker(
  stdout: CommandContext["stdout"],
  coworker: unknown,
  heading = "",
): void {
  const value = record(coworker);
  const channels = record(value.metadata).channels;
  const channelText =
    channels && typeof channels === "object" && !Array.isArray(channels)
      ? Object.entries(channels)
          .map(([provider, item]) => `${provider}=${String(item)}`)
          .join(", ")
      : "";
  writeText(stdout, [
    heading ||
      `${String(value.name || "Unnamed Coworker")} [${String(value.id || "unknown")}]`,
    value.baseURL ? `baseURL: ${String(value.baseURL)}` : undefined,
    Array.isArray(value.capabilities) && value.capabilities.length
      ? `capabilities: ${value.capabilities.join(", ")}`
      : undefined,
    channelText ? `channels: ${channelText}` : undefined,
  ]);
}

export async function runCoworkersCommand({
  client,
  stdout,
  json = false,
  signal,
  target,
  subcommand,
  positionalId,
  options,
}: CoworkersCommandContext): Promise<void> {
  const command = subcommand || "list";
  if (command === "list") {
    const limit = parsePositiveInteger(option(options, "limit"), "--limit");
    const capabilities = normalizeCapabilities(option(options, "capability"));
    const { coworkers } = await fetchCoworkers(
      client,
      { scope: optionString(options, "scope"), capabilities },
      signal,
    );
    const filtered = applyListFilters(coworkers, {
      search: option(options, "search"),
      limit,
      fields: (item) => {
        const value = record(item);
        return [
          value.id,
          value.slug,
          value.name,
          value.company,
          value.caption,
          value.description,
          ...(Array.isArray(value.capabilities) ? value.capabilities : []),
        ];
      },
    });
    if (json) writeJson(stdout, { coworkers: filtered });
    else printCoworkerList(stdout, filtered);
    return;
  }
  if (command === "provision") {
    requirePreprodCoworkerRegistration(target);
    if (optionBoolean(options, "personal"))
      throw new Error(
        "Use --personal with coworkers register or connect, not provision",
      );
    if (option(options, "workspace-id") !== undefined) {
      throw new Error(
        "Use `coworkers connect` to grant Workspace access after provisioning. Omit --workspace-id here.",
      );
    }
    if (optionBoolean(options, "create-api-key")) {
      throw new Error(
        "The developer creates their runtime key with `coworkers api-key COWORKER_ID --json`. Omit --create-api-key here.",
      );
    }
    const payload = await buildPayload(options, "provision");
    const vendorId = String(payload.vendorId);
    const user = await fetchUserIdentity(client, signal);
    const isPlatformAdmin = hasPlatformAdminRole(user);
    if (!isPlatformAdmin) {
      const { vendors } = await fetchVendorMemberships(client, signal);
      requireAdministeredVendorForRegistration(vendors, vendorId);
    }
    let coworker: Awaited<ReturnType<typeof createCoworker>>["coworker"];
    let isWhitelisted: unknown;
    try {
      const created = await createCoworker(client, payload, signal);
      coworker = created.coworker;
      isWhitelisted = record(created.response.data).isWhitelisted;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Invalid vendor response:")
      ) {
        throw new Error(
          "Core returned an invalid Coworker Vendor. Creation may have succeeded. Inspect `sokosumi --preprod coworkers list --scope all` before retrying.",
        );
      }
      rethrowCoworkerCreationError(error, vendorId);
    }
    if (!coworker.id?.trim()) {
      throw new Error(
        "Core returned no Coworker ID. Creation may have succeeded. Check `sokosumi --preprod coworkers list --scope all` before retrying.",
      );
    }
    if (coworker.vendor?.id !== vendorId) {
      throw new Error(
        `Core returned Coworker ${coworker.id}, but its Vendor does not match ${vendorId}. Creation may have succeeded. Inspect Coworker ${coworker.id} with \`sokosumi --preprod coworkers list --scope all\` before retrying.`,
      );
    }
    if (isWhitelisted !== false) {
      throw new Error(
        `Core returned Coworker ${coworker.id}, but its private approval state could not be confirmed. Creation may have succeeded. Inspect Coworker ${coworker.id} before retrying.`,
      );
    }
    if (json)
      writeJson(stdout, {
        coworker,
        handoff: { coworkerId: coworker.id, vendorId },
      });
    else
      writeText(stdout, [
        isPlatformAdmin ? "Admin step complete." : "Private Coworker created.",
        `Provisioned ${coworker.name} [${coworker.id}] under Vendor ${vendorId}.`,
        isPlatformAdmin
          ? `Give Coworker ID ${coworker.id} and Vendor ID ${vendorId} to the developer.`
          : `Keep Coworker ID ${coworker.id} and Vendor ID ${vendorId} for connection.`,
        "Developer: confirm your account, select a Workspace, then connect and check Seat eligibility:",
        "  sokosumi --preprod auth whoami --json",
        "  sokosumi --preprod workspaces list",
        `  sokosumi --preprod coworkers connect ${coworker.id} --vendor-id ${vendorId} --workspace-id ORGANIZATION_ID`,
        "  sokosumi --preprod workspaces check ORGANIZATION_ID",
        "Operator: create the runtime key in a trusted terminal:",
        `  sokosumi --preprod coworkers api-key ${coworker.id} --json`,
        "Send the key to the agent host through secure stdin.",
      ]);
    return;
  }
  if (command === "register") {
    requirePreprodCoworkerRegistration(target);
    const workspace = await selectCoworkerWorkspaceTarget(
      client,
      options,
      signal,
    );
    const payload = await buildPayload(options, "register");
    const vendorId = String(payload.vendorId);
    const { vendors } = await fetchVendorMemberships(client, signal);
    requireAdministeredVendorForRegistration(vendors, vendorId);
    if (optionBoolean(options, "personal"))
      await ensurePersonalWorkspace(client, signal);
    let coworker: Awaited<ReturnType<typeof createCoworker>>["coworker"];
    try {
      ({ coworker } = await createCoworker(client, payload, signal));
    } catch (error) {
      rethrowCoworkerCreationError(
        error,
        vendorId,
        workspace.organizationId ?? "PERSONAL_WORKSPACE",
      );
    }
    const coworkerId = String(record(coworker).id || "");
    let workspaceAccess: CoworkerWorkspaceAccess;
    try {
      ({ access: workspaceAccess } = await grantCoworkerWorkspaceAccess(
        client,
        coworkerId,
        workspace.target,
        signal,
      ));
    } catch (error) {
      throw new Error(
        `Coworker ${coworkerId} was created, but Workspace access could not be confirmed. Retry with \`sokosumi coworkers connect ${coworkerId} --vendor-id ${vendorId} ${workspace.connectionOptions} --preprod\`. Cause: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!["GRANTED", "PENDING"].includes(workspaceAccess.status)) {
      throw new Error(
        `Coworker ${coworkerId} was created, but Workspace access is ${workspaceAccess.status}. Keep this Coworker ID. A Workspace owner or admin must resolve the access state. Do not register again.`,
      );
    }
    if (optionBoolean(options, "personal")) {
      try {
        if (workspaceAccess.coworkerId !== coworkerId)
          throw new Error("Core returned access for a different Coworker");
        await verifyPersonalWorkspace(
          client,
          workspaceAccess.workspaceId,
          signal,
        );
      } catch (error) {
        const message = `Coworker ${coworkerId} was created, but personal Workspace access could not be confirmed. Do not register again. Inspect access, then retry with \`sokosumi coworkers connect ${coworkerId} --vendor-id ${vendorId} --personal --preprod\`.`;
        const { code, status } = classifyError(error);
        throw status === undefined
          ? new CliError(code, message)
          : Object.assign(new Error(message), { status });
      }
    }
    let apiKey: unknown = null;
    if (optionBoolean(options, "create-api-key")) {
      try {
        const result = await createCoworkerApiKey(
          client,
          coworkerId,
          {
            name: optionString(options, "api-key-name"),
            expiresAt: optionString(options, "api-key-expires-at"),
          },
          signal,
        );
        apiKey = result.apiKey;
      } catch (error) {
        throw new Error(
          `Coworker ${coworkerId} exists with Workspace access ${workspaceAccess.status} for ${workspace.name || workspace.organizationId}, but API key creation could not be confirmed. Do not register again. If you did not receive a usable key, run \`sokosumi --preprod coworkers api-key ${coworkerId} --json\` to create one. Cause: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (json) writeJson(stdout, { coworker, workspaceAccess, apiKey });
    else {
      const coworkerValue = record(coworker);
      writeText(stdout, [
        workspaceAccess.status === "PENDING"
          ? `Workspace approval requested for Coworker ${coworkerId}. Access ID: ${workspaceAccess.id}. Keep this Coworker ID. Do not register again.`
          : `Registered coworker ${String(coworkerValue.name || coworkerValue.id)} [${coworkerId}] in Workspace ${workspace.name || workspace.organizationId} [${workspaceAccess.workspaceId}]`,
        workspaceAccess.status === "PENDING"
          ? `Wait for a Workspace owner or admin to approve access. Then retry \`sokosumi --preprod coworkers connect ${coworkerId} --vendor-id ${vendorId} ${workspace.connectionOptions}\`.`
          : undefined,
        workspaceAccess.status === "PENDING" ? PENDING_KEY_GUIDANCE : undefined,
        coworkerValue.baseURL
          ? `baseURL: ${String(coworkerValue.baseURL)}`
          : undefined,
        Array.isArray(coworkerValue.capabilities)
          ? `capabilities: ${coworkerValue.capabilities.join(", ")}`
          : undefined,
        record(apiKey).token
          ? `coworker api key: ${maskSecret(record(apiKey).token)}`
          : undefined,
        record(apiKey).token
          ? "WARNING: Token is partially masked in text output. Use --json to retrieve the full token."
          : undefined,
        record(apiKey).token
          ? "Store this token securely. It is only returned once."
          : undefined,
      ]);
    }
    return;
  }
  if (command === "connect") {
    requirePreprodCoworkerRegistration(target);
    const coworkerId = positionalId || optionString(options, "coworker-id");
    if (!coworkerId)
      throw new Error(
        "coworker id is required for `coworkers connect`. Use the ID returned by `coworkers provision` or `coworkers register`.",
      );
    const vendorId = optionString(options, "vendor-id")?.trim();
    if (!vendorId)
      throw new Error(
        "vendor id is required for `coworkers connect`. Run `sokosumi --preprod vendors me` to find the Vendor you administer.",
      );
    const workspace = await selectCoworkerWorkspaceTarget(
      client,
      options,
      signal,
    );
    const { vendors } = await fetchVendorMemberships(client, signal);
    requireAdministeredVendorForRegistration(vendors, vendorId);
    const { coworker } = await fetchCoworker(client, coworkerId, signal);
    if (!coworker.vendor) {
      throw new Error(
        `Core could not verify the Vendor for Coworker ${coworkerId}. Workspace access was not requested. Ask the organizer to check the Coworker record.`,
      );
    }
    if (coworker.vendor.id !== vendorId) {
      throw new Error(
        `Coworker ${coworkerId} belongs to Vendor ${coworker.vendor.id}, but --vendor-id selected ${vendorId}. Check the Coworker ID and Vendor ID with the organizer before retrying.`,
      );
    }
    if (optionBoolean(options, "personal"))
      await ensurePersonalWorkspace(client, signal);
    let access: CoworkerWorkspaceAccess;
    try {
      ({ access } = await grantCoworkerWorkspaceAccess(
        client,
        coworkerId,
        workspace.target,
        signal,
      ));
    } catch (error) {
      rethrowWorkspaceAccessError(error, coworkerId);
    }
    if (!["GRANTED", "PENDING"].includes(access.status)) {
      throw new Error(
        `Coworker ${coworkerId} Workspace access is ${access.status}. Keep this Coworker ID. A Workspace owner or admin must resolve the access state. Do not register again.`,
      );
    }
    if (optionBoolean(options, "personal")) {
      if (access.coworkerId !== coworkerId)
        throw new Error(
          "Core returned access for a different Coworker. Inspect access before retrying.",
        );
      await verifyPersonalWorkspace(client, access.workspaceId, signal);
    }
    if (json) writeJson(stdout, { coworkerId, workspaceAccess: access });
    else
      writeText(stdout, [
        access.status === "PENDING"
          ? `Workspace approval requested for Coworker ${coworkerId}. Access ID: ${access.id}. Keep this Coworker ID. Do not register again.`
          : `Connected coworker ${coworkerId} to Workspace ${workspace.name || workspace.organizationId} [${access.workspaceId}]`,
        access.status === "PENDING"
          ? `Wait for a Workspace owner or admin to approve access. Then retry \`sokosumi --preprod coworkers connect ${coworkerId} --vendor-id ${vendorId} ${workspace.connectionOptions}\`.`
          : workspace.organizationId === null
            ? "Next: sokosumi --preprod tasks create --personal --coworker-id COWORKER_ID --description DESCRIPTION"
            : `Next: sokosumi --preprod workspaces check ${workspace.organizationId}`,
        access.status === "PENDING" ? PENDING_KEY_GUIDANCE : undefined,
        `Then ask the operator to configure the key on the agent host with \`sokosumi runtime key-import --coworker-id ${coworkerId} --api-key-stdin\`.`,
        "The operator supplies the Coworker key through secure stdin.",
      ]);
    return;
  }
  if (command === "update") {
    const id = positionalId || optionString(options, "id");
    if (!id) throw new Error("coworker id is required for `coworkers update`");
    const { coworker } = await updateCoworker(
      client,
      id,
      await buildPayload(options, "update"),
      signal,
    );
    if (json) writeJson(stdout, { coworker });
    else
      printCoworker(
        stdout,
        coworker,
        `Updated coworker ${String(record(coworker).name || record(coworker).id)} [${String(record(coworker).id)}]`,
      );
    return;
  }
  if (command === "api-key") {
    const id = positionalId || optionString(options, "id");
    if (!id) throw new Error("coworker id is required for `coworkers api-key`");
    const { apiKey } = await createCoworkerApiKey(
      client,
      id,
      {
        name: optionString(options, "api-key-name"),
        expiresAt: optionString(options, "api-key-expires-at"),
      },
      signal,
    );
    if (json) writeJson(stdout, { coworkerId: id, apiKey });
    else
      writeText(stdout, [
        `Created API key for coworker ${id}`,
        record(apiKey).name
          ? `name: ${String(record(apiKey).name)}`
          : undefined,
        `token: ${maskSecret(record(apiKey).token)}`,
        "WARNING: Token is partially masked in text output. Use --json to retrieve the full token.",
        "Store this token securely. It is only returned once.",
      ]);
    return;
  }
  if (command === "me") {
    const { coworker } = await fetchCurrentCoworker(client, signal);
    if (json) writeJson(stdout, { coworker });
    else printCoworker(stdout, coworker);
    return;
  }
  throw new Error(`Unknown coworkers subcommand: ${command}`);
}

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
  connectMpsSeller,
  fetchMpsSeller,
  revokeMpsSeller,
  validateMpsUrl,
} from "../../api/services/mps-seller-service.js";
import { fetchOrganizationWorkspaces } from "../../api/services/organization-workspace-service.js";
import { fetchUserIdentity } from "../../api/services/user-identity-service.js";
import { fetchVendorMemberships } from "../../api/services/vendor-service.js";
import type { CliTargetConfig } from "../../auth/config.js";
import { readSecretStdin } from "../read-secret-stdin.js";
import {
  requireAdministeredVendorForRegistration,
  requireOrganizationWorkspacesForRegistration,
  requirePreprodCoworkerRegistration,
  requireSelectedOrganizationWorkspace,
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

export interface CoworkersCommandContext extends CommandContext {
  target?: CliTargetConfig["target"];
  subcommand?: string;
  positionalId?: string;
  options?: CommandOptions;
  readStdin?: () => string;
}

const MPS_CONNECT_OPTIONS = new Set([
  "mps-url",
  "agent-identifier",
  "wallet-id",
  "payment-source-id",
  "mps-api-key-stdin",
]);
const MPS_COMMON_OPTIONS = new Set([
  "json",
  "preprod",
  "api-url",
  "auth-url",
  "client-id",
]);

export function validateMpsSellerCommand({
  subcommand,
  positionalId,
  options,
}: Pick<
  CoworkersCommandContext,
  "subcommand" | "positionalId" | "options"
>): void {
  if (
    !positionalId?.trim() ||
    positionalId === "." ||
    positionalId === ".." ||
    /[\s\p{Cc}\p{Cf}]/u.test(positionalId)
  ) {
    throw new Error("A valid Coworker ID is required for MPS seller commands");
  }
  for (const name of Object.keys(options ?? {})) {
    if (
      !MPS_COMMON_OPTIONS.has(name) &&
      !(subcommand === "mps-connect" && MPS_CONNECT_OPTIONS.has(name)) &&
      !(subcommand === "mps-revoke" && name === "binding-id")
    ) {
      throw new Error(
        `Option --${name} is not supported by this MPS seller command`,
      );
    }
  }
  if (subcommand === "mps-connect") {
    if (options?.["mps-api-key-stdin"] !== true) {
      throw new Error("coworkers mps-connect requires --mps-api-key-stdin");
    }
    for (const name of [
      "mps-url",
      "agent-identifier",
      "wallet-id",
      "payment-source-id",
    ]) {
      const value = optionString(options, name);
      if (
        !value?.trim() ||
        value.length > 2_048 ||
        /[\s\p{Cc}\p{Cf}]/u.test(value)
      ) {
        throw new Error(`coworkers mps-connect requires a valid --${name}`);
      }
    }
    validateMpsUrl(optionString(options, "mps-url") ?? "");
    if (
      !/^(?:[0-9a-fA-F]{2})+$/u.test(
        optionString(options, "agent-identifier") ?? "",
      )
    ) {
      throw new Error("--agent-identifier must contain hexadecimal bytes");
    }
  }
  if (subcommand === "mps-revoke") {
    const bindingId = optionString(options, "binding-id");
    if (
      !bindingId?.trim() ||
      bindingId.length > 2_048 ||
      /[\s\p{Cc}\p{Cf}]/u.test(bindingId)
    ) {
      throw new Error("coworkers mps-revoke requires a valid --binding-id");
    }
  }
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
        "Coworker creation requires a Sokosumi platform admin on Preprod.",
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
  readStdin,
}: CoworkersCommandContext): Promise<void> {
  const command = subcommand || "list";
  if (["mps-connect", "mps-status", "mps-revoke"].includes(command)) {
    validateMpsSellerCommand({ subcommand: command, positionalId, options });
    const coworkerId = positionalId ?? "";
    const timeout = AbortSignal.timeout(30_000);
    const boundedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    boundedSignal.throwIfAborted();
    let seller;
    if (command === "mps-connect") {
      if (!readStdin && process.stdin.isTTY) {
        throw new Error(
          "Pipe the MPS API key into stdin. Do not put secrets in command arguments.",
        );
      }
      let input: string;
      try {
        input = readStdin ? readStdin() : await readSecretStdin(boundedSignal);
      } catch {
        throw new Error("Could not read the MPS API key from stdin");
      }
      const apiKey = input.trim();
      if (
        !apiKey ||
        Buffer.byteLength(input, "utf8") > 16_384 ||
        Buffer.byteLength(apiKey, "utf8") > 4_096 ||
        /[\s\p{Cc}\p{Cf}]/u.test(apiKey) ||
        /^(?:coworker_|soko_)/u.test(apiKey)
      ) {
        throw new Error(
          "stdin must contain one MPS API key of at most 4 KiB, without whitespace",
        );
      }
      seller = await connectMpsSeller(
        client,
        coworkerId,
        {
          apiUrl: optionString(options, "mps-url") ?? "",
          apiKey,
          agentIdentifier: optionString(options, "agent-identifier") ?? "",
          walletId: optionString(options, "wallet-id") ?? "",
          paymentSourceId: optionString(options, "payment-source-id") ?? "",
        },
        boundedSignal,
      );
    } else if (command === "mps-revoke") {
      seller = await revokeMpsSeller(
        client,
        coworkerId,
        optionString(options, "binding-id") ?? "",
        boundedSignal,
      );
    } else {
      seller = await fetchMpsSeller(client, coworkerId, boundedSignal);
    }
    if (json) writeJson(stdout, { seller });
    else
      writeText(stdout, [
        seller === null
          ? "No MPS seller is connected."
          : seller.revokedAt === null
            ? "MPS seller setup verified."
            : "MPS seller connection revoked.",
        seller ? `Binding ID: ${seller.id}` : undefined,
        seller ? `Network: ${seller.network}` : undefined,
        "Payments are disabled. Seller setup does not enable paid Tasks.",
      ]);
    return;
  }
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
    if (!hasPlatformAdminRole(user)) {
      throw new Error(
        `Signed in on Preprod as ${user.email} [${user.id}], platform role: ${user.platformRole}. Coworker creation requires a Sokosumi platform admin. Send Vendor ${vendorId} and your final Coworker name to the organizer. Check your account with \`sokosumi --preprod auth whoami --json\`.`,
      );
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
        "Admin step complete.",
        `Provisioned ${coworker.name} [${coworker.id}] under Vendor ${vendorId}.`,
        `Give Coworker ID ${coworker.id} and Vendor ID ${vendorId} to the developer.`,
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
    const { organizationWorkspaces } = await fetchOrganizationWorkspaces(
      client,
      signal,
    );
    requireOrganizationWorkspacesForRegistration(organizationWorkspaces);
    const workspace = requireSelectedOrganizationWorkspace(
      organizationWorkspaces,
      optionString(options, "workspace-id"),
    );
    const payload = await buildPayload(options, "register");
    const vendorId = String(payload.vendorId);
    const { vendors } = await fetchVendorMemberships(client, signal);
    requireAdministeredVendorForRegistration(vendors, vendorId);
    let coworker: Awaited<ReturnType<typeof createCoworker>>["coworker"];
    try {
      ({ coworker } = await createCoworker(client, payload, signal));
    } catch (error) {
      rethrowCoworkerCreationError(error, vendorId, workspace.organizationId);
    }
    const coworkerId = String(record(coworker).id || "");
    let workspaceAccess: CoworkerWorkspaceAccess;
    try {
      ({ access: workspaceAccess } = await grantCoworkerWorkspaceAccess(
        client,
        coworkerId,
        { organizationId: workspace.organizationId },
        signal,
      ));
    } catch (error) {
      throw new Error(
        `Coworker ${coworkerId} was created, but Workspace access could not be confirmed. Retry with \`sokosumi coworkers connect ${coworkerId} --vendor-id ${vendorId} --workspace-id ${workspace.organizationId} --preprod\`. Cause: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (workspaceAccess.status !== "GRANTED") {
      throw new Error(
        `Coworker ${coworkerId} was created, but Workspace access is ${workspaceAccess.status}. Registration is incomplete. Retry with \`sokosumi coworkers connect ${coworkerId} --vendor-id ${vendorId} --workspace-id ${workspace.organizationId} --preprod\` after access is approved.`,
      );
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
          `Coworker ${coworkerId} is connected to Workspace ${workspace.organizationId}, but API key creation could not be confirmed. Do not register again. If you did not receive a usable key, run \`sokosumi --preprod coworkers api-key ${coworkerId} --json\` to create one. Cause: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (json) writeJson(stdout, { coworker, workspaceAccess, apiKey });
    else {
      const coworkerValue = record(coworker);
      writeText(stdout, [
        `Registered coworker ${String(coworkerValue.name || coworkerValue.id)} [${coworkerId}] in Workspace ${workspace.name || workspace.organizationId} [${workspace.organizationId}]`,
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
        "coworker id is required for `coworkers connect`. Ask the organizer for the Coworker ID after they create it under your Vendor.",
      );
    const vendorId = optionString(options, "vendor-id")?.trim();
    if (!vendorId)
      throw new Error(
        "vendor id is required for `coworkers connect`. Run `sokosumi --preprod vendors me` to find the Vendor you administer.",
      );
    const { organizationWorkspaces } = await fetchOrganizationWorkspaces(
      client,
      signal,
    );
    requireOrganizationWorkspacesForRegistration(organizationWorkspaces);
    const workspace = requireSelectedOrganizationWorkspace(
      organizationWorkspaces,
      optionString(options, "workspace-id"),
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
    const { access } = await grantCoworkerWorkspaceAccess(
      client,
      coworkerId,
      { organizationId: workspace.organizationId },
      signal,
    );
    if (access.status !== "GRANTED") {
      throw new Error(
        `Coworker ${coworkerId} Workspace access is ${access.status}. Registration is incomplete. Wait for Workspace approval, then retry this command.`,
      );
    }
    if (json) writeJson(stdout, { coworkerId, workspaceAccess: access });
    else
      writeText(stdout, [
        `Connected coworker ${coworkerId} to Workspace ${workspace.name || workspace.organizationId} [${workspace.organizationId}]`,
        `Next: sokosumi --preprod workspaces check ${workspace.organizationId}`,
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

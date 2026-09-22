import type { Vendor } from "../../api/models/vendor.js";
import {
  createVendor,
  fetchVendorMemberships,
} from "../../api/services/vendor-service.js";
import {
  type CommandContext,
  writeJson,
  writeText,
} from "./command-helpers.js";

export interface VendorsCommandContext extends CommandContext {
  subcommand?: string;
  options?: Record<string, unknown>;
}

function optionString(
  options: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = options?.[key];
  return typeof value === "string" ? value : undefined;
}

function printVendors(
  stdout: CommandContext["stdout"],
  vendors: readonly Vendor[],
): void {
  if (!vendors.length) {
    writeText(stdout, ["No vendors found."]);
    return;
  }
  const lines = ["Vendors"];
  for (const vendor of vendors) {
    lines.push(`${vendor.name || "Unnamed Vendor"} [${vendor.id}]`);
    if (vendor.slug) lines.push(`  slug: ${vendor.slug}`);
    if (vendor.role) lines.push(`  role: ${vendor.role}`);
  }
  writeText(stdout, lines);
}

export async function runVendorsCommand({
  client,
  stdout,
  json = false,
  signal,
  subcommand,
  options,
}: VendorsCommandContext): Promise<void> {
  if (subcommand === "create") {
    const { vendor } = await createVendor(
      client,
      {
        name: optionString(options, "name") ?? "",
        slug: optionString(options, "slug") ?? "",
      },
      signal,
    );
    if (json) writeJson(stdout, { vendor });
    else {
      writeText(stdout, [
        `Created vendor ${vendor.name || "Unnamed Vendor"} [${vendor.id}]`,
        vendor.slug ? `slug: ${vendor.slug}` : undefined,
        `role: ${vendor.role ?? "admin"}`,
      ]);
    }
    return;
  }
  if (subcommand !== "me") {
    throw new Error(
      "Usage: sokosumi vendors me | vendors create --name NAME --slug SLUG",
    );
  }
  const { vendors } = await fetchVendorMemberships(client, signal);
  if (json) writeJson(stdout, { vendors });
  else printVendors(stdout, vendors);
}

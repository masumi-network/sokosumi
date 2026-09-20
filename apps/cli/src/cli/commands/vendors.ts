import type { Vendor } from "../../api/models/vendor.js";
import { fetchVendorMemberships } from "../../api/services/vendor-service.js";
import {
  type CommandContext,
  isJson,
  writeJson,
  writeText,
} from "./command-helpers.js";

export interface VendorsCommandContext extends CommandContext {
  subcommand?: string;
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
}: VendorsCommandContext): Promise<void> {
  // Dispatch requires the explicit vendors me form; bare vendors is rejected.
  if (subcommand !== "me") throw new Error("Usage: sokosumi vendors me");
  const { vendors } = await fetchVendorMemberships(client, signal);
  if (isJson({ json })) writeJson(stdout, { vendors });
  else printVendors(stdout, vendors);
}

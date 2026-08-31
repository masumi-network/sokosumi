export interface CreditBucketOwnerXorCliArgs {
  dryRun: boolean;
  organizationId?: string;
  verbose: boolean;
}

export function parseCreditBucketOwnerXorArgs(
  argv: string[],
): CreditBucketOwnerXorCliArgs {
  let dryRun = false;
  let organizationId: string | undefined;
  let verbose = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--verbose" || arg === "-v") {
      verbose = true;
      continue;
    }
    if (arg === "--organization-id") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--organization-id requires a value");
      }
      organizationId = value;
      index += 1;
      continue;
    }
    throw new Error(
      `unknown argument "${arg}"; supported: --dry-run, --verbose|-v, --organization-id <id>`,
    );
  }
  return { dryRun, organizationId, verbose };
}

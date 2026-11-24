/**
 * Fails the Core build before `prisma migrate deploy` when the schema names
 * or the Preprod switch could mix the Networks (`checkNetworkLayout` in
 * `src/config/network-layout.ts`). Core checks the same at every start, but a start that
 * fails only after the deploy is live answers every request with an error.
 * Only these four variables: the rest of the environment is checked at start.
 * Both imports load only `zod`, so no logger or runtime module starts here.
 */
import process from "node:process";

import { invalidVariables } from "../src/config/invalid-variables";
import { networkLayoutSchema } from "../src/config/network-layout";

const result = networkLayoutSchema.safeParse(process.env);
if (!result.success) {
  console.error(
    "Core's schema layout could mix the Networks; the deploy stops here.",
    JSON.stringify(invalidVariables(result.error.issues, process.env)),
  );
  process.exit(1);
}

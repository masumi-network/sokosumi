/**
 * Fails the Core build before `prisma migrate deploy` when the schema names
 * or the Preprod switch could mix the Networks (`checkNetworkLayout` in
 * `src/config/env.ts`). Core checks the same at every start, but a start that
 * fails only after the deploy is live answers every request with an error.
 * Only these four variables: the rest of the environment is checked at start.
 */
import process from "node:process";

import { invalidVariables, networkLayoutSchema } from "../src/config/env";

const result = networkLayoutSchema.safeParse(process.env);
if (!result.success) {
  console.error(
    "Core's schema layout could mix the Networks; the deploy stops here.",
    JSON.stringify(invalidVariables(result.error.issues, process.env)),
  );
  process.exit(1);
}

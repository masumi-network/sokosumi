import { createLoader, parseAsString } from "nuqs/server";

/** What Better Auth appends to Core's `onAPIError.errorURL`. */
export const loadAuthErrorSearchParams = createLoader({
  error: parseAsString,
  error_description: parseAsString,
});

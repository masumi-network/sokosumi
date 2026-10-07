import { createLoader, parseAsString } from "nuqs/server";

/** `next`: the page the app frame sent the user here from. */
export const loadWorkspaceGateSearchParams = createLoader({
  next: parseAsString,
});

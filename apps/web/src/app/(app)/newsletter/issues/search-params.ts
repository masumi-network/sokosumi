import { createLoader, parseAsBoolean, parseAsString } from "nuqs/server";

export const issueSearchParams = { cursor: parseAsString };
export const loadIssueSearchParams = createLoader(issueSearchParams);
export const loadIssueEditorSearchParams = createLoader({
  draftedBySokoBot: parseAsBoolean.withDefault(false),
});

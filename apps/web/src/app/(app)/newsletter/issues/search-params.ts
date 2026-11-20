import { createLoader, parseAsBoolean, parseAsString } from "nuqs/server";

export const ISSUE_SEARCH_MAX_LENGTH = 200;

export const issueSearchParams = {
  cursor: parseAsString,
  q: parseAsString.withDefault(""),
};
export const loadIssueSearchParams = createLoader(issueSearchParams);
export const loadIssueEditorSearchParams = createLoader({
  draftedBySokoBot: parseAsBoolean.withDefault(false),
});

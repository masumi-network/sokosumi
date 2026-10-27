import { createLoader, parseAsString } from "nuqs/server";

export const issueSearchParams = { cursor: parseAsString };
export const loadIssueSearchParams = createLoader(issueSearchParams);

import { createLoader, parseAsString } from "nuqs/server";

export const analyticsSearchParams = {
  from: parseAsString,
  to: parseAsString,
  cursor: parseAsString,
};
export const loadAnalyticsSearchParams = createLoader(analyticsSearchParams);

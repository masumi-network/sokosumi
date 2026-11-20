import { createFormatter } from "next-intl";

export const SEO_RESULT_LOCALE = "en";
/** Use for calendar days in a report. Member-local instants use useSeoResultFormatter. */
export const seoResultFormat = createFormatter({
  locale: SEO_RESULT_LOCALE,
  timeZone: "UTC",
});

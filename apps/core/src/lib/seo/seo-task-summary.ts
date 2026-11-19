import type { RequestSeoAnalysis } from "@/schemas/project-seo.schema";

const KIND_LABELS: Record<RequestSeoAnalysis["kind"], string> = {
  audit_full: "Full SEO audit",
  audit_lite: "Quick SEO audit",
  page_check: "SEO page check",
  rankings: "SEO ranking check",
  links: "SEO link check",
};
/** Pages listed by name; the request line keeps every page. */
const LISTED_PAGES = 10;

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** The readable part of an SEO Task description, above its request line. */
export function seoTaskSummary(
  input: Pick<
    RequestSeoAnalysis,
    "kind" | "keywords" | "countryCode" | "languageCode" | "devices"
  >,
  pageUrls: string[],
): string {
  const pages = pageUrls.slice(0, LISTED_PAGES).map((url) => `- ${url}`);
  if (pageUrls.length > LISTED_PAGES)
    pages.push(`- and ${pageUrls.length - LISTED_PAGES} more`);
  // A full audit sends only its first keyword (seoTaskPacket).
  const keywords =
    input.kind === "audit_full" ? input.keywords.slice(0, 1) : input.keywords;
  const details = [
    `Search market: ${input.countryCode}, language: ${input.languageCode}.`,
    ...(keywords.length
      ? [
          `${keywords.length === 1 ? "Keyword" : "Keywords"}: ${keywords.join(", ")}.`,
        ]
      : []),
    ...(input.kind === "audit_full"
      ? []
      : [`Devices: ${input.devices.join(", ")}.`]),
  ];
  return [
    `${KIND_LABELS[input.kind]} of ${count(pageUrls.length, "page")}:`,
    "",
    ...pages,
    "",
    ...details,
  ].join("\n");
}

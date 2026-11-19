import type { RequestSeoAnalysis } from "@/schemas/project-seo.schema";

const KIND_LABELS: Record<RequestSeoAnalysis["kind"], string> = {
  audit_full: "Full SEO audit",
  audit_lite: "Quick SEO audit",
  page_check: "SEO page check",
  rankings: "SEO ranking check",
  links: "SEO link check",
};
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** The readable part of an SEO Task description, above its request line. */
export function seoTaskSummary(
  input: Pick<
    RequestSeoAnalysis,
    "kind" | "keywords" | "countryCode" | "languageCode" | "devices"
  >,
  pageUrls: string[],
): string {
  // A full audit sends only its first keyword (seoTaskPacket).
  const keywords =
    input.kind === "audit_full" ? input.keywords.slice(0, 1) : input.keywords;
  const details = [
    `Search market: ${input.countryCode}, language: ${input.languageCode}.`,
    ...(keywords.length
      ? [
          // Not "Keyword:": the worker reads that label from free-text Tasks.
          `Target ${keywords.length === 1 ? "keyword" : "keywords"}: ${keywords.join(", ")}.`,
        ]
      : []),
    ...(input.kind === "audit_full"
      ? []
      : [`Devices: ${input.devices.join(", ")}.`]),
  ];
  return [
    // Selected pages: a full audit can add related pages as it runs.
    `${KIND_LABELS[input.kind]} of ${count(pageUrls.length, "selected page")}:`,
    "",
    ...pageUrls.map((url) => `- ${url}`),
    "",
    ...details,
  ].join("\n");
}

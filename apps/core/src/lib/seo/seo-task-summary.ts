import type { RequestSeoAnalysis } from "@/schemas/project-seo.schema";

const KIND_LABELS: Record<RequestSeoAnalysis["kind"], string> = {
  audit_full: "Full SEO audit",
  audit_lite: "Quick SEO audit",
  page_check: "SEO page check",
  rankings: "SEO ranking check",
  links: "SEO link check",
};
/** The worker modules a request runs (the SEO worker's analysesOf). */
export function selectedModules(
  input: Pick<RequestSeoAnalysis, "kind" | "analyses">,
): string[] {
  if (input.kind === "page_check") return ["page.inspect"];
  if (input.kind === "rankings") return ["keyword.refresh"];
  if (input.kind === "links") return ["links.refresh"];
  return input.analyses ?? ["page.inspect"];
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** The readable part of an SEO Task description, above its request line. */
export function seoTaskSummary(
  input: Pick<
    RequestSeoAnalysis,
    | "kind"
    | "keywords"
    | "countryCode"
    | "languageCode"
    | "devices"
    | "analyses"
  >,
  pageUrls: string[],
  competitorUrls: string[] = [],
): string {
  // A full audit sends only its first keyword (seoTaskPacket); a focused
  // check reads keywords only for rank reads.
  const modules = input.kind === "audit_full" ? [] : selectedModules(input);
  const keywords =
    input.kind === "audit_full"
      ? input.keywords.slice(0, 1)
      : modules.includes("keyword.refresh")
        ? input.keywords
        : [];
  const details = [
    `Search market: ${input.countryCode}, language: ${input.languageCode}.`,
    ...(keywords.length
      ? [
          // Not "Keyword:": the worker reads that label from free-text Tasks.
          `Target ${keywords.length === 1 ? "keyword" : "keywords"}: ${keywords.join(", ")}.`,
        ]
      : []),
    // Page reads and rank reads run per device; a full audit uses both.
    ...(modules.some((m) => m === "page.inspect" || m === "keyword.refresh")
      ? [`Devices: ${input.devices.join(", ")}.`]
      : []),
  ];
  const competitors = competitorUrls.length
    ? ["", "Competitors:", ...competitorUrls.map((url) => `- ${url}`)]
    : [];
  return [
    // Selected pages: a full audit can add related pages as it runs.
    `${KIND_LABELS[input.kind]} of ${count(pageUrls.length, "selected page")}:`,
    "",
    ...pageUrls.map((url) => `- ${url}`),
    ...competitors,
    "",
    ...details,
  ].join("\n");
}

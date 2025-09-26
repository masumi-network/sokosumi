export interface SearchableJobLink {
  title: string | null | undefined;
  url: string | null | undefined;
}

export interface SearchableJob {
  id: string;
  name: string | null;
  input: string | null;
  output: string | null;
  links?: SearchableJobLink[] | null;
}

export function jobMatchesQuery(job: SearchableJob, query: string): boolean {
  if (!query) return true;
  const term = query.toLowerCase();

  const searchableFields = [
    job.name,
    job.id,
    (() => {
      try {
        const output = JSON.parse(job.output ?? "{}");
        return typeof output.result === "string" ? output.result : "";
      } catch {
        return "";
      }
    })(),
    (() => {
      try {
        const input = JSON.parse(job.input ?? "{}");
        return Object.values(input)
          .filter((value) => typeof value === "string")
          .join(" ");
      } catch {
        return "";
      }
    })(),
    ...(Array.isArray(job.links)
      ? job.links.map((link) => `${link.title ?? ""} ${link.url ?? ""}`)
      : []),
  ]
    .filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    )
    .map((text) => text.toLowerCase());

  return searchableFields.some((text) => text.includes(term));
}

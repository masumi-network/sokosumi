export interface SearchableJobLink {
  title: string | null | undefined;
  url: string | null | undefined;
}

export interface SearchableJob {
  id: string;
  name: string | null;
  input: string | null;
  result: string | null;
}

export function jobMatchesQuery(job: SearchableJob, query: string): boolean {
  if (!query) return true;
  const term = query.toLowerCase();

  const searchableFields = [
    job.name,
    job.id,
    job.result,
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
  ]
    .filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    )
    .map((text) => text.toLowerCase());

  return searchableFields.some((text) => text.includes(term));
}

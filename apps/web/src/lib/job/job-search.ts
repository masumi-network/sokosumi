export interface SearchableJobLink {
  title: string | null | undefined;
  url: string | null | undefined;
}

interface SearchableJobEvent {
  input: string | null;
  result: string | null;
}

export interface SearchableJob {
  id: string;
  name: string | null;
  events: SearchableJobEvent[];
}

export function jobMatchesQuery(job: SearchableJob, query: string): boolean {
  if (!query) return true;
  const term = query.toLowerCase();

  // Collect input/result from all events
  const eventFields = job.events.flatMap((event) => [
    event.result,
    (() => {
      try {
        const input = JSON.parse(event.input ?? "{}");
        return Object.values(input)
          .filter((value) => typeof value === "string")
          .join(" ");
      } catch {
        return "";
      }
    })(),
  ]);

  const searchableFields = [job.name, job.id, ...eventFields]
    .filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    )
    .map((text) => text.toLowerCase());

  return searchableFields.some((text) => text.includes(term));
}

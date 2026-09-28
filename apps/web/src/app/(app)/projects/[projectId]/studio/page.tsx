import { redirect } from "next/navigation";

// Nothing to paint early: this route only resolves where to send the reader.
export const instant = false;

interface LegacyProjectStudioPageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Where the image studio used to live.
 *
 * It is a top-level destination now, scoped by `?projectId=`, so this route
 * exists only to keep bookmarks and older links working. Every other query
 * param is carried over, which is what makes a shared link to one version
 * (`?v=…`) or one conversation (`?s=…`) still land on that version.
 */
export default async function LegacyProjectStudioPage({
  params,
  searchParams,
}: LegacyProjectStudioPageProps) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);

  const next = new URLSearchParams({ projectId });
  for (const [key, value] of Object.entries(query)) {
    if (key === "projectId" || value === undefined) continue;
    for (const entry of Array.isArray(value) ? value : [value]) {
      next.append(key, entry);
    }
  }

  redirect(`/studio?${next.toString()}`);
}

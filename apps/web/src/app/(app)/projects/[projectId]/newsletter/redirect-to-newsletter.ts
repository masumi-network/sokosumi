import { notFound, redirect } from "next/navigation";
import type { SearchParams } from "nuqs/server";

import { PROJECT_SCOPE_PARAM } from "@/app/components/project-scope/project-scope-href";
import { newsletterService } from "@/lib/services/newsletter.service";

/**
 * Newsletter used to live under the project page. Its old links land on the
 * top-level section, with the project as `?projectId=` and any other query
 * (a cursor, a status filter) kept.
 */
export async function redirectToNewsletter(
  path: string,
  projectId: string,
  searchParams: Promise<SearchParams>,
): Promise<never> {
  if (!(await newsletterService.isEnabled())) notFound();
  const query = new URLSearchParams({ [PROJECT_SCOPE_PARAM]: projectId });
  for (const [key, value] of Object.entries(await searchParams)) {
    if (key === PROJECT_SCOPE_PARAM) continue;
    for (const item of [value ?? []].flat()) query.append(key, item);
  }
  redirect(`${path}?${query}`);
}

import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import type { SearchParams } from "nuqs/server";
import { calendarUrl } from "@/app/calendar/calendar-url";
import { PROJECT_SCOPE_PARAM } from "@/app/components/project-scope/project-scope-href";
import { newsletterService } from "@/lib/services/newsletter.service";

export const instant = false;

/** Newsletter issues are a filter on the Calendar now; keep the old link working. */
export default async function NewsletterCalendarPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await connection();
  if (!(await newsletterService.isEnabled())) notFound();
  const projectId = (await searchParams)[PROJECT_SCOPE_PARAM];
  redirect(
    calendarUrl({
      types: "newsletter",
      projectId: typeof projectId === "string" ? projectId : undefined,
    }),
  );
}

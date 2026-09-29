import { redirect } from "next/navigation";

// Nothing to paint early: this route only resolves where to send the reader.
export const instant = false;

interface LegacyProjectCalendarPageProps {
  params: Promise<{ projectId: string }>;
}

/**
 * Where a project's calendar used to live.
 *
 * A project is not a place that contains a calendar any more: `/calendar`
 * takes a project scope like every other workspace page, and the sidebar's
 * switcher is how you narrow it. The route survives as a redirect so links
 * and bookmarks still arrive at the right week for the right project.
 */
export default async function LegacyProjectCalendarPage({
  params,
}: LegacyProjectCalendarPageProps) {
  const { projectId } = await params;
  redirect(`/calendar?projectId=${encodeURIComponent(projectId)}`);
}

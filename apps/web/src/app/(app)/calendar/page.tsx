import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { CalendarPageSearchParams } from "@/app/calendar/load-calendar-page";

interface CalendarPageProps {
  searchParams: Promise<CalendarPageSearchParams>;
}

const PRESERVED_CALENDAR_PARAMS = [
  "assigneeId",
  "assigneeUserId",
  "date",
  "projectId",
  "sourceId",
  "scope",
  "socialOnly",
  "status",
  "postStatus",
  "view",
  "timezone",
] as const satisfies ReadonlyArray<keyof CalendarPageSearchParams>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Calendar.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function CalendarPage({
  searchParams,
}: CalendarPageProps) {
  const params = await searchParams;
  const next = new URLSearchParams();
  next.set("tab", "calendar");
  for (const key of PRESERVED_CALENDAR_PARAMS) {
    const value = params[key];
    if (typeof value === "string" && value.length > 0) {
      next.set(key, value);
    }
  }
  redirect(`/tasks?${next.toString()}`);
}

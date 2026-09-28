import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import SchedulesLoading from "./loading";
import {
  SchedulesPageContent,
  type SchedulesSearchParams,
} from "./schedules-page-content";

interface SchedulesPageProps {
  searchParams: Promise<SchedulesSearchParams>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Tasks.Schedules.Page");

  return {
    title: t("title"),
    description: t("description"),
  };
}

/** Every Task Schedule of the workspace, filtered by project and state. */
export default function SchedulesPage({ searchParams }: SchedulesPageProps) {
  return (
    <Suspense fallback={<SchedulesLoading />}>
      <SchedulesPageContent searchParams={searchParams} />
    </Suspense>
  );
}

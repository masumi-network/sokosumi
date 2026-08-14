import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import {
  CreateTaskModal,
  CreateTaskModalProvider,
} from "@/app/tasks/components/create-task-modal";
import { getCoworkerOptions } from "@/app/tasks/utils/coworker-options";
import { CoworkerGallerySection } from "@/components/agents/coworker-gallery-section";
import { Skeleton } from "@/components/ui/skeleton";
import { coworkerService } from "@/lib/services/coworker.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Agents.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

function CoworkersTierFallback() {
  return (
    <section className="space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56 md:h-8" />
        <Skeleton className="h-4 w-80 md:h-5" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-40 w-full rounded-xl" />
        ))}
      </div>
    </section>
  );
}

async function CoworkersTier() {
  // Defer before any cookies()/headers()-bound work so PPR shell probing does
  // not soft-reject dynamic APIs while filling this Suspense hole.
  await connection();

  const coworkers = await coworkerService
    .listCoworkers("tasks")
    .catch(() => []);
  const coworkerOptions = getCoworkerOptions(coworkers);

  return (
    <CreateTaskModalProvider>
      <CoworkerGallerySection coworkers={coworkers} />
      <CreateTaskModal coworkerOptions={coworkerOptions} />
    </CreateTaskModalProvider>
  );
}

export default function GalleryPage() {
  return (
    <div className="w-full">
      <div className="space-y-16 pb-8 md:space-y-24 md:px-2">
        <Suspense fallback={<CoworkersTierFallback />}>
          <CoworkersTier />
        </Suspense>
      </div>
    </div>
  );
}

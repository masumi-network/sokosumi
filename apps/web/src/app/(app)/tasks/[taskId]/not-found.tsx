import { Archive } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { HOLDER_CLASS } from "@/components/ui/holder-surface";

// A link to a task that was archived lands here too: Core answers 404 for it.
// Synchronous on purpose, like the root not-found (PPR resume, SOK-1080).
export default function TaskNotFound() {
  const t = useTranslations("App.Tasks.NotFound");

  return (
    <div className="content-in flex w-full flex-col pb-6">
      <div className={HOLDER_CLASS}>
        <EmptyState
          icon={Archive}
          title={t("title")}
          description={t("description")}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild variant="outline">
                <Link href="/tasks/archived">{t("archived")}</Link>
              </Button>
              <Button asChild>
                <Link href="/tasks">{t("back")}</Link>
              </Button>
            </div>
          }
        />
      </div>
    </div>
  );
}

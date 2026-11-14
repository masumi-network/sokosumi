"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { seoProjectHref } from "../seo-href";
import { SeoAuditForm } from "./seo-audit-form";
import { SeoOnboardingArt } from "./seo-onboarding-art";
import { SeoStep, SeoStepList } from "./seo-steps";
import type { useCreateSeoAudit } from "./use-create-seo-audit";

const TITLE_ID = "seo-onboarding-title";

/** First run: one form to add a page, then the steps the Audit unlocks. */
export function SeoAuditOnboarding({
  form,
  projectId,
}: {
  form: ReturnType<typeof useCreateSeoAudit>;
  projectId: string | null;
}) {
  const t = useTranslations("App.Seo.audits");
  return (
    <div className={HOLDER_CLASS}>
      <section
        aria-labelledby={TITLE_ID}
        className={cn(
          HOLDER_ITEM_CLASS,
          "grid overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]",
        )}
      >
        <div className="space-y-8 p-5 sm:p-8">
          <header className="space-y-3">
            <p className="text-muted-foreground text-sm font-medium">
              {t("onboarding.eyebrow")}
            </p>
            <h2
              id={TITLE_ID}
              className="text-2xl font-light tracking-tight md:text-3xl"
            >
              {projectId ? t("onboarding.titleProject") : t("onboarding.title")}
            </h2>
            <p className="text-muted-foreground max-w-prose text-sm">
              {t("onboarding.body")}
            </p>
          </header>
          <SeoStepList label={t("onboarding.steps")}>
            <SeoStep
              stagger
              index={1}
              mark="active"
              title={t("onboarding.addTitle")}
              body={t("onboarding.addBody")}
            >
              {/* The dialog's width: the button stays near the fields it submits. */}
              <div className="max-w-lg">
                <SeoAuditForm form={form} />
              </div>
            </SeoStep>
            <SeoStep
              stagger
              index={2}
              mark="todo"
              title={t("onboarding.connectTitle")}
              body={t("onboarding.connectBody")}
            />
            <SeoStep
              stagger
              index={3}
              mark="todo"
              last
              title={t("onboarding.checkTitle")}
              body={t("onboarding.checkBody")}
            />
          </SeoStepList>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground text-sm">
              {t("onboarding.trust")}
            </p>
            {projectId ? (
              <Button variant="outline" asChild>
                <Link href={seoProjectHref(projectId)}>
                  {t("projectWorkspace")}
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
        <div className="bg-quinary border-border hidden items-center justify-center border-s p-8 lg:flex">
          <SeoOnboardingArt />
        </div>
      </section>
    </div>
  );
}

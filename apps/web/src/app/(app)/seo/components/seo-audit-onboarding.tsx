"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { seoProjectHref } from "../seo-href";
import { SeoAuditForm } from "./seo-audit-form";
import { SeoOnboardingArt } from "./seo-onboarding-art";
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
        <ol role="list" aria-label={t("onboarding.steps")}>
          <SeoOnboardingStep
            index={1}
            active
            title={t("onboarding.addTitle")}
            body={t("onboarding.addBody")}
          >
            <SeoAuditForm form={form} />
          </SeoOnboardingStep>
          <SeoOnboardingStep
            index={2}
            title={t("onboarding.connectTitle")}
            body={t("onboarding.connectBody")}
          />
          <SeoOnboardingStep
            index={3}
            last
            title={t("onboarding.checkTitle")}
            body={t("onboarding.checkBody")}
          />
        </ol>
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
      <div className="bg-quinary border-border hidden items-center justify-center border-l p-8 lg:flex">
        <SeoOnboardingArt />
      </div>
    </section>
  );
}

function SeoOnboardingStep({
  index,
  title,
  body,
  active = false,
  last = false,
  children,
}: {
  index: number;
  title: string;
  body: string;
  active?: boolean;
  last?: boolean;
  children?: ReactNode;
}) {
  return (
    <li
      className={cn("relative flex gap-4", !last && "pb-8")}
      aria-current={active ? "step" : undefined}
    >
      {last ? null : (
        <span
          aria-hidden
          className="bg-border absolute top-10 bottom-2 left-4 w-px -translate-x-1/2"
        />
      )}
      <span
        aria-hidden
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-medium",
          active
            ? "bg-primary text-primary-foreground"
            : "border-border bg-background text-muted-foreground border",
        )}
      >
        {index}
      </span>
      <div className="min-w-0 flex-1 space-y-1 pt-1">
        <h3 className={cn("font-medium", !active && "text-muted-foreground")}>
          {title}
        </h3>
        <p className="text-muted-foreground max-w-prose text-sm">{body}</p>
        {children ? <div className="pt-4">{children}</div> : null}
      </div>
    </li>
  );
}

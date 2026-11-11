"use client";

import { NewsletterTemplate } from "@sokosumi/core-client";
import { Copy, ImageIcon, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { newsletterHref } from "@/app/newsletter/newsletter-tabs";
import { Button } from "@/components/ui/button";
import { ButtonLoadingBar } from "@/components/ui/button-loading-bar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  copyNewsletterIssue,
  createNewsletterIssue,
} from "@/lib/actions/newsletter/issues";
import { newsletterTemplateContent } from "./templates";

export interface LatestIssue {
  id: string;
  subject: string;
}

export function NewIssueDialog({
  projectId,
  latestIssue,
  onClose,
  onCloseAutoFocus,
}: {
  projectId: string;
  latestIssue: LatestIssue | null;
  onClose: () => void;
  onCloseAutoFocus: () => void;
}) {
  const t = useTranslations("App.Projects.Newsletter.Issues");
  const router = useRouter();
  const [pending, setPending] = useState<
    NewsletterTemplate | "blank" | "latest" | null
  >(null);
  const [error, setError] = useState("");

  function createFrom(start: NewsletterTemplate | "blank") {
    const template = start === "blank" ? NewsletterTemplate.TEXT : start;
    return createNewsletterIssue({
      projectId,
      values: {
        subject: t("Templates.subject"),
        template,
        content:
          start === "blank" ? [] : newsletterTemplateContent(template, t),
      },
    });
  }

  async function handleCreate(
    start: NewsletterTemplate | "blank" | "latest",
    request: () => ReturnType<typeof createNewsletterIssue>,
  ) {
    if (pending) return;
    setPending(start);
    setError("");
    try {
      const result = await request();
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.push(
        newsletterHref(
          `/newsletter/issues/${encodeURIComponent(result.value.id)}`,
          projectId,
        ),
      );
      onClose();
    } catch {
      setError(t("createError"));
    } finally {
      setPending(null);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto overscroll-contain sm:max-w-2xl"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{t("Templates.title")}</DialogTitle>
          <DialogDescription>{t("Templates.description")}</DialogDescription>
        </DialogHeader>
        {latestIssue ? (
          <div className="bg-card-background flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl p-4">
            <p className="text-muted-foreground min-w-0 flex-1 text-sm wrap-anywhere">
              {t("Templates.latestDescription", {
                subject: latestIssue.subject,
              })}
            </p>
            <Button
              variant="outline"
              disabled={pending !== null}
              loading={pending === "latest"}
              onClick={() =>
                void handleCreate("latest", () =>
                  copyNewsletterIssue({ projectId, issueId: latestIssue.id }),
                )
              }
            >
              <Copy />
              {t("Templates.latest")}
            </Button>
          </div>
        ) : null}
        <div className="bg-card-background flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl p-4">
          <p className="text-muted-foreground min-w-0 flex-1 text-sm">
            {t("Templates.blankDescription")}
          </p>
          <Button
            variant="primary"
            disabled={pending !== null}
            loading={pending === "blank"}
            onClick={() =>
              void handleCreate("blank", () => createFrom("blank"))
            }
          >
            <Plus />
            {t("Templates.blank")}
          </Button>
        </div>
        <h3 className="text-sm font-medium">
          {t("Templates.templateHeading")}
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          {Object.values(NewsletterTemplate).map((template) => (
            <button
              key={template}
              type="button"
              disabled={!!pending}
              aria-busy={pending === template}
              onClick={() =>
                void handleCreate(template, () => createFrom(template))
              }
              className="focus-visible:ring-ring focus-visible:inset-ring-ring relative min-w-0 space-y-3 overflow-hidden rounded-xl border p-4 text-start outline-none hover:bg-accent focus-visible:ring-2 focus-visible:inset-ring-1 disabled:opacity-50"
            >
              <div
                aria-hidden
                className="bg-background-muted flex h-32 flex-col justify-center gap-2 rounded-md p-4"
              >
                <div className="bg-foreground h-2 w-2/3 rounded-xs" />
                {template === NewsletterTemplate.IMAGES ? (
                  <div className="bg-quaternary flex h-10 items-center justify-center rounded-xs">
                    <ImageIcon className="text-muted-foreground size-5" />
                  </div>
                ) : null}
                <div className="bg-quaternary h-1 w-full rounded-xs" />
                <div className="bg-quaternary h-1 w-4/5 rounded-xs" />
                {template === NewsletterTemplate.BUTTONS ? (
                  <div className="bg-primary h-5 w-1/2 rounded-xs" />
                ) : (
                  <div className="bg-quaternary h-1 w-3/4 rounded-xs" />
                )}
                <div
                  className={
                    template === NewsletterTemplate.IMAGES
                      ? "bg-quaternary h-5 w-full rounded-xs"
                      : "border-t"
                  }
                />
              </div>
              <span className="block font-medium">
                {t(`Templates.${template}.title`)}
              </span>
              <span className="text-muted-foreground block text-sm">
                {t(`Templates.${template}.description`)}
              </span>
              {pending === template ? <ButtonLoadingBar /> : null}
            </button>
          ))}
        </div>
        {error ? (
          <p role="alert" className="text-foreground text-sm">
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

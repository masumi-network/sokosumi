"use client";

import type { CreateNewsletterIssueRequest } from "@sokosumi/core-client";
import { useQuery } from "@tanstack/react-query";
import { Monitor, Smartphone } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useDebounce } from "use-debounce";
import { z } from "zod";
import { PreviewFrame } from "@/components/common/preview-frame";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { newsletterIssueInputSchema } from "@/lib/schemas/newsletter-issues";
import { cn } from "@/lib/utils";

export function NewsletterIssuePreview({
  projectId,
  values,
}: {
  projectId: string;
  values: CreateNewsletterIssueRequest;
}) {
  const t = useTranslations("App.Projects.Newsletter.Issues");
  const [device, setDevice] = useState("desktop");
  const current = JSON.stringify(values);
  const [body] = useDebounce(current, 600);
  const parsed = newsletterIssueInputSchema(t).safeParse(JSON.parse(body));
  const preview = useQuery({
    queryKey: ["newsletter-preview", projectId, body],
    enabled: parsed.success,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/newsletter/issues/preview`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body,
          signal,
        },
      );
      if (!response.ok) throw new Error(t("Preview.error"));
      return z.object({ html: z.string() }).parse(await response.json());
    },
  });
  return (
    <aside
      aria-label={t("Preview.title")}
      className="bg-background-muted min-w-0 space-y-4 rounded-xl border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold">{t("Preview.title")}</h3>
        <ToggleGroup
          type="single"
          value={device}
          onValueChange={(value) => {
            if (value) setDevice(value);
          }}
          variant="outline"
          aria-label={t("Preview.title")}
        >
          <ToggleGroupItem value="mobile" className="min-h-10 gap-2">
            <Smartphone className="size-4" />
            {t("Preview.mobile")}
          </ToggleGroupItem>
          <ToggleGroupItem value="desktop" className="min-h-10 gap-2">
            <Monitor className="size-4" />
            {t("Preview.desktop")}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <p role="status" className="text-muted-foreground text-sm">
        {!parsed.success
          ? t("Preview.invalid")
          : preview.isFetching || body !== current
            ? t("Preview.loading")
            : null}
      </p>
      {preview.isError && parsed.success ? (
        <div className="space-y-2">
          <p role="alert" className="text-semantic-destructive-label text-sm">
            {t("Preview.error")}
          </p>
          <Button variant="outline" onClick={() => void preview.refetch()}>
            {t("Preview.retry")}
          </Button>
        </div>
      ) : null}
      {preview.data && parsed.success ? (
        <PreviewFrame
          className={cn("mx-auto w-full", device === "mobile" && "max-w-sm")}
        >
          <iframe
            title={t("Preview.label")}
            srcDoc={preview.data.html}
            sandbox=""
            referrerPolicy="no-referrer"
            className="h-[40rem] w-full border-0"
          />
        </PreviewFrame>
      ) : null}
    </aside>
  );
}

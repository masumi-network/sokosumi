"use client";

import type { CreateNewsletterIssueRequest } from "@sokosumi/core-client";
import { useQuery } from "@tanstack/react-query";
import { Monitor, Smartphone } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { useDebounce } from "use-debounce";
import { z } from "zod";
import { PreviewFrame } from "@/components/common/preview-frame";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { newsletterIssueInputSchema } from "@/lib/schemas/newsletter-issues";

export function NewsletterIssuePreview({
  projectId,
  values,
}: {
  projectId: string;
  values: CreateNewsletterIssueRequest;
}) {
  const t = useTranslations("App.Projects.Newsletter.Issues");
  const [device, setDevice] = useState("desktop");
  const frameRef = useRef<HTMLElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  useMountEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => {
      setAvailableWidth(entry.contentRect.width);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  });
  const viewportWidth = device === "mobile" ? 375 : 720;
  const scale =
    availableWidth > 0 ? Math.min(1, availableWidth / viewportWidth) : 1;
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
      <PreviewFrame
        ref={frameRef}
        hidden={!preview.data || !parsed.success}
        className="mx-auto w-full"
        style={{
          maxWidth: viewportWidth + 2,
          height: Math.round(640 * scale) + 2,
        }}
      >
        {preview.data && parsed.success ? (
          <iframe
            title={t("Preview.label")}
            srcDoc={preview.data.html}
            sandbox=""
            referrerPolicy="no-referrer"
            className="block max-w-none origin-top-left border-0"
            style={{
              width: viewportWidth,
              height: 640,
              transform: `scale(${scale})`,
            }}
          />
        ) : null}
      </PreviewFrame>
    </aside>
  );
}

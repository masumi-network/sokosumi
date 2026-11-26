"use client";

import { useTranslations } from "next-intl";
import { useRef } from "react";
import { useRoomPdfRenderer } from "@/hooks/effects/use-room-pdf-renderer";

/**
 * A PDF drawn page by page onto canvases, so the browser's own viewer, with
 * its save button, never opens a file the room does not let people download.
 * The watermark is in the pages themselves, stamped by Core.
 */
export function RoomPdf({ url }: { url: string }) {
  const t = useTranslations("Share.Room");
  const container = useRef<HTMLDivElement>(null);
  const state = useRoomPdfRenderer({ container, url, t });

  return (
    <div className="grid gap-3">
      {state === "loading" ? (
        <p className="text-muted-foreground text-sm" role="status">
          {t("loadingFile")}
        </p>
      ) : null}
      {state === "failed" ? (
        <p className="text-semantic-destructive text-sm" role="alert">
          {t("fileFailed")}
        </p>
      ) : null}
      <div ref={container} className="grid gap-3" />
    </div>
  );
}

"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { FileDetailView } from "@/app/drive/components/file-detail-view";
import { Button } from "@/components/ui/button";

/**
 * The shareable deep link to one file.
 *
 * The detail page is no longer the main way to see a file — a sheet opened from
 * the row is — but this route keeps working, because a link to a document is
 * something people paste to each other and a URL that stops resolving is a
 * promise broken after the fact.
 *
 * It renders `FileDetailView`, the same component the sheet renders. Everything
 * about the document lives there; this file is the route's chrome and nothing
 * else, which is what stops the page and the sheet from drifting apart.
 */
export function FileDetailClient({ resourceId }: { resourceId: string }) {
  const t = useTranslations("App.Drive.Files");

  return (
    <FileDetailView
      resourceId={resourceId}
      leading={
        <Button
          asChild
          variant="ghost"
          size="icon"
          aria-label={t("backToFiles")}
        >
          <Link href="/drive?view=workspace">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
      }
    />
  );
}

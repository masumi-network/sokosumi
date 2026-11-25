"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  designMdTokens,
  splitFrontMatter,
} from "@/components/design-md/design-md-front-matter";
import { Button } from "@/components/ui/button";
import { useFilesArchiveDownload } from "@/hooks/effects/use-files-archive-download";
import type { ArchiveFile } from "@/lib/files-archive";

// Subtypes whose usual extension differs from their name.
const LOGO_EXTENSIONS: Record<string, string> = {
  jpeg: "jpg",
  "svg+xml": "svg",
  "x-icon": "ico",
  "vnd.microsoft.icon": "ico",
};

/**
 * The store keeps logos under a content hash with no extension, so the type
 * it serves names the file. An unknown type gets no extension, never a wrong
 * one.
 */
function logoName(type: string | null): string {
  const subtype = /^image\/([\w.+-]+)/.exec(
    type?.split(";")[0]?.trim().toLowerCase() ?? "",
  )?.[1];
  if (!subtype) return "logo";
  const extension =
    LOGO_EXTENSIONS[subtype] ?? (/^[a-z0-9]+$/.test(subtype) ? subtype : null);
  return extension ? `logo.${extension}` : "logo";
}

function textUrl(text: string, type: string): string {
  return `data:${type};charset=utf-8,${encodeURIComponent(text)}`;
}

/**
 * What a designer or printer asks for, in one zip: the DESIGN.md as written,
 * its colours and type styles as plain text to copy from, and the logo.
 * Text goes in as data URLs, so the shared archive builder fetches every
 * entry the same way and names a logo it could not load.
 */
function brandKitFiles({
  markdown,
  logo,
  labels,
}: {
  markdown: string;
  logo: { url: string; type: string | null } | null;
  labels: { colors: string; typography: string };
}): ArchiveFile[] {
  const files: ArchiveFile[] = [
    { name: "DESIGN.md", fileUrl: textUrl(markdown, "text/markdown") },
  ];

  const { colors, typography } = designMdTokens(
    splitFrontMatter(markdown)?.frontMatter ?? "",
  );
  const sections = [
    colors.length > 0
      ? [labels.colors, ...colors.map((c) => `${c.name}: ${c.value}`)]
      : [],
    typography.length > 0
      ? [
          labels.typography,
          ...typography.map(
            (s) =>
              `${s.name}: ${[s.family, s.size, s.weight].filter(Boolean).join(" · ")}`,
          ),
        ]
      : [],
  ].filter((lines) => lines.length > 0);
  if (sections.length > 0) {
    const text = `${sections.map((lines) => lines.join("\n")).join("\n\n")}\n`;
    files.push({ name: "brand.txt", fileUrl: textUrl(text, "text/plain") });
  }

  if (logo) {
    files.push({ name: logoName(logo.type), fileUrl: logo.url });
  }
  return files;
}

/** Null when the store does not answer; the zip step then names the logo as missing. */
async function logoType(
  url: string,
  signal: AbortSignal,
): Promise<string | null> {
  try {
    const response = await fetch(url, { method: "HEAD", signal });
    return response.ok ? response.headers.get("content-type") : null;
  } catch {
    return null;
  }
}

export function BrandKitDownloadButton({
  projectName,
  markdown,
  logoUrl,
}: {
  projectName: string;
  markdown: string;
  logoUrl: string | null;
}) {
  const t = useTranslations("App.Projects.Detail.design");
  const { downloading, download } = useFilesArchiveDownload(
    "App.Projects.Detail.design.brandKitArchive",
  );
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="gap-1.5"
      data-testid="project-brand-kit-download"
      loading={downloading}
      onClick={() =>
        download(t("brandKitFileName", { name: projectName }), async (signal) =>
          brandKitFiles({
            markdown,
            logo: logoUrl
              ? { url: logoUrl, type: await logoType(logoUrl, signal) }
              : null,
            labels: { colors: t("colors"), typography: t("typography") },
          }),
        )
      }
    >
      <Download className="size-4" aria-hidden />
      {t("downloadBrandKit")}
    </Button>
  );
}

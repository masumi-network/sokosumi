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

const LOGO_EXTENSION = /\.(png|jpe?g|svg|webp|gif|ico|avif)$/i;

function textUrl(text: string, type: string): string {
  return `data:${type};charset=utf-8,${encodeURIComponent(text)}`;
}

/**
 * What a designer or printer asks for, in one zip: the DESIGN.md as written,
 * its colours and type styles as plain text to copy from, and the logo.
 * Text goes in as data URLs, so the shared archive builder fetches every
 * entry the same way and names a logo it could not load.
 */
export function brandKitFiles({
  markdown,
  logoUrl,
  labels,
}: {
  markdown: string;
  logoUrl: string | null;
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

  if (logoUrl) {
    const extension =
      LOGO_EXTENSION.exec(logoUrl.split(/[?#]/)[0] ?? "")?.[0].toLowerCase() ??
      ".png";
    files.push({ name: `logo${extension}`, fileUrl: logoUrl });
  }
  return files;
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
  const { downloading, download } = useFilesArchiveDownload();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="gap-1.5"
      data-testid="project-brand-kit-download"
      loading={downloading}
      onClick={() =>
        download(t("brandKitFileName", { name: projectName }), () =>
          brandKitFiles({
            markdown,
            logoUrl,
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

import { Download, File, Folder } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import {
  DRIVE_SHARE_UNLOCK_COOKIE,
  readDriveShare,
} from "@/lib/services/drive-share.server";
import { formatBytes } from "@/lib/utils/format-bytes";
import { SharedFilesPasswordForm } from "./password-form";

export const instant = false;

interface SharedFilesPageProps {
  params: Promise<{ token: string }>;
}

async function load(params: SharedFilesPageProps["params"]) {
  await connection();
  const { token } = await params;
  const proof = (await cookies()).get(DRIVE_SHARE_UNLOCK_COOKIE)?.value;
  return { token, share: await readDriveShare(token, proof) };
}

export async function generateMetadata({
  params,
}: SharedFilesPageProps): Promise<Metadata> {
  const { share } = await load(params);
  const t = await getTranslations("Share.Files");
  return {
    title: share ? share.name : t("notFoundTitle"),
    // A link is for the people it was sent to, never for search engines.
    robots: { index: false, follow: false },
  };
}

function downloadHref(token: string, path?: string): string {
  const base = `/share/files/${encodeURIComponent(token)}/download`;
  return path ? `${base}?path=${encodeURIComponent(path)}` : base;
}

export default async function SharedFilesPage({
  params,
}: SharedFilesPageProps) {
  const { token, share } = await load(params);
  if (!share) return notFound();
  const t = await getTranslations("Share.Files");
  const Icon = share.kind === "folder" ? Folder : File;

  return (
    <div className="container mx-auto flex justify-center p-4 md:px-8 md:py-10">
      <section className="bg-card-background w-full max-w-2xl rounded-xl border p-5 md:p-6">
        <header className="mb-5 flex min-w-0 items-center gap-3">
          <span className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
            <Icon aria-hidden className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{share.name}</h1>
            <p className="text-muted-foreground text-sm">
              {share.kind === "folder" ? t("sharedFolder") : t("sharedFile")}
            </p>
          </div>
        </header>

        {share.locked ? (
          <SharedFilesPasswordForm token={token} />
        ) : share.kind === "file" ? (
          <Button asChild>
            <a href={downloadHref(token)}>
              <Download aria-hidden className="size-4" />
              {t("download")}
              {share.items?.[0]
                ? ` · ${formatBytes(share.items[0].size)}`
                : null}
            </a>
          </Button>
        ) : share.items && share.items.length > 0 ? (
          <>
            <ul className="divide-border divide-y rounded-lg border">
              {share.items.map((item) => (
                <li
                  key={item.path}
                  className="flex min-w-0 items-center gap-3 px-3 py-2"
                >
                  <File
                    aria-hidden
                    className="text-muted-foreground size-4 shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {item.path}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {formatBytes(item.size)}
                  </span>
                  <Button
                    asChild
                    variant="ghost"
                    size="icon"
                    className="size-10 shrink-0 md:size-8"
                  >
                    <a
                      href={downloadHref(token, item.path)}
                      aria-label={t("downloadFile", { name: item.path })}
                    >
                      <Download aria-hidden className="size-4" />
                    </a>
                  </Button>
                </li>
              ))}
            </ul>
            {share.truncated ? (
              <p className="text-muted-foreground mt-3 text-xs">
                {t("truncated")}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-muted-foreground text-sm">{t("emptyFolder")}</p>
        )}
      </section>
    </div>
  );
}

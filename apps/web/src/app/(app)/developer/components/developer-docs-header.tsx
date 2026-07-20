import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

export async function DeveloperDocsHeader() {
  const t = await getTranslations("App.Developer");

  return (
    <div className="space-y-2 pt-2">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-muted-foreground text-sm">{t("description")}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <Link
          href="https://www.masumi.network/dev/sokosumi/documentation"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:text-primary/80 inline-flex items-center gap-1 underline underline-offset-4"
        >
          {t("docs.gettingStarted")}
          <ExternalLink className="size-3" />
        </Link>
        <Link
          href="https://www.masumi.network/dev/sokosumi/api-reference"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:text-primary/80 inline-flex items-center gap-1 underline underline-offset-4"
        >
          {t("docs.apiReference")}
          <ExternalLink className="size-3" />
        </Link>
        <Link
          href="https://www.masumi.network/dev/sokosumi/mcp"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:text-primary/80 inline-flex items-center gap-1 underline underline-offset-4"
        >
          {t("docs.mcp")}
          <ExternalLink className="size-3" />
        </Link>
      </div>
    </div>
  );
}

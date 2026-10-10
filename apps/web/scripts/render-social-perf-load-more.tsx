import { NextIntlClientProvider, useTranslations } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "@/components/ui/button";
import en from "../messages/en.json";

function Shot({ failed }: { failed: boolean }) {
  const t = useTranslations("App.Projects.SocialPosts.statistics");
  return (
    <div className="space-y-6" data-testid="social-statistics">
      <section className="space-y-4" aria-label={t("postsTitle")}>
        <h3 className="text-sm font-semibold">{t("postsTitle")}</h3>
        <ul className="space-y-3">
          <li className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium">Launch account</p>
              <p className="text-muted-foreground text-xs">Oct 1, 2026</p>
            </div>
            <p className="text-sm whitespace-pre-wrap break-words">
              Published outside Sokosumi
            </p>
          </li>
        </ul>
        <div className="space-y-3">
          {failed ? (
            <p className="text-sm" role="alert">
              {t("loadMoreError")}
            </p>
          ) : null}
          <Button variant="outline">{t("loadMore")}</Button>
        </div>
      </section>
    </div>
  );
}

const failed = process.argv[2] === "after";

process.stdout.write(
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <Shot failed={failed} />
    </NextIntlClientProvider>,
  ),
);

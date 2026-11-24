import { ListTodo, type LucideIcon, Mail, Share2 } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import type { GoingOutPage, GoingOutRow } from "./going-out-today-data";

const KIND_ICON: Record<GoingOutRow["kind"], LucideIcon> = {
  social: Share2,
  newsletter: Mail,
  task: ListTodo,
};

/** Statuses that mean it may not go out unless someone acts. */
const NEEDS_A_LOOK = new Set<GoingOutRow["status"]>([
  "NEEDS_APPROVAL",
  "FAILED",
  "MISSED",
]);

/**
 * Home's "Going out today": the Social posts, newsletter issues and scheduled
 * Task runs set for the reader's day, each with its own status, so a post
 * waiting for approval never reads as going out for sure. Renders nothing on
 * a quiet day or a failed read.
 */
export async function GoingOutToday({
  feed,
}: {
  feed: Promise<GoingOutPage | null>;
}) {
  const [page, t, tSocial, tNewsletter, tTask, tCalendar, format] =
    await Promise.all([
      feed,
      getTranslations("App.Chat.Landing.GoingOut"),
      getTranslations("App.Projects.SocialPosts"),
      getTranslations("App.Projects.Newsletter.Issues"),
      getTranslations("App.Tasks.Filters"),
      getTranslations("App.Calendar.socialPost"),
      getFormatter(),
    ]);
  if (!page || page.rows.length === 0) return null;

  function statusLabel(row: GoingOutRow): string {
    switch (row.kind) {
      case "social":
        return tSocial(`status.${row.status}`);
      case "newsletter":
        return tNewsletter(`statuses.${row.status}`);
      case "task":
        return row.status === "PLANNED"
          ? t("planned")
          : tTask(`statusOptions.${row.status}`);
    }
  }

  return (
    <section aria-labelledby="home-going-out" data-testid="home-going-out">
      <div className="flex items-center justify-between gap-2 px-3 pb-2">
        <h2 id="home-going-out" className="text-foreground text-sm font-medium">
          {t("title")}
        </h2>
        <Link
          href={page.calendarHref}
          className="text-muted-foreground hover:text-foreground inline-flex min-h-6 items-center focus-visible:ring-ring rounded-sm text-sm outline-hidden focus-visible:ring-2"
        >
          {page.total > page.rows.length
            ? t("seeAllCount", { count: page.total })
            : t("seeAll")}
        </Link>
      </div>
      <ul className="flex flex-col">
        {page.rows.map((row) => {
          const Icon = KIND_ICON[row.kind];
          return (
            <li key={row.id} data-testid="home-going-out-row">
              <Link
                href={row.href}
                className="hover:bg-accent focus-visible:ring-ring flex min-w-0 items-center gap-3 rounded-md px-3 py-2 outline-hidden transition-colors focus-visible:ring-2"
              >
                {/* Laid out like the rows of "In the last 24 hours": the
                    icon centres on the whole row, and on a phone the time
                    and status take a line under the title. */}
                <Icon
                  aria-hidden
                  className="text-muted-foreground size-4 shrink-0"
                />
                <span className="min-w-0 flex-1 text-sm sm:flex sm:items-center sm:gap-3">
                  <span className="text-foreground line-clamp-2 break-words sm:line-clamp-1 sm:flex-1">
                    <span className="sr-only">{t(`kinds.${row.kind}`)}: </span>
                    {row.title.trim() || tCalendar("mediaOnly")}
                  </span>
                  <span className="flex items-center gap-2 sm:shrink-0">
                    <time
                      dateTime={row.at.toISOString()}
                      className="text-muted-foreground tabular-nums"
                    >
                      {format.dateTime(row.at, "time")}
                    </time>
                    <span
                      className={
                        NEEDS_A_LOOK.has(row.status)
                          ? "text-foreground font-medium"
                          : "text-muted-foreground"
                      }
                    >
                      {statusLabel(row)}
                    </span>
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

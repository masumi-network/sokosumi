import type { ContactKind } from "@sokosumi/core-client";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ContactAvatar } from "@/app/contacts/components/contact-visuals";
import { DUE_DAY_FORMAT, dueDayDate } from "@/app/tasks/utils/task-due";
import { coreClient } from "@/lib/clients/core.client";
import { cn } from "@/lib/utils";

export const FOLLOW_UPS_LIMIT = 5;

/** One contact to get back to, as plain data. */
export interface FollowUpRow {
  id: string;
  name: string;
  kind: ContactKind;
  avatarUrl: string | null;
  nextStep: string | null;
  /** `YYYY-MM-DD`, on or before the day it was read for. */
  followUpAt: string;
}

export interface FollowUpsPage {
  rows: FollowUpRow[];
  /** All contacts due, so the list can say how many it leaves out. */
  total: number;
}

/**
 * The workspace's live contacts with a follow-up on or before `today` (the
 * reader's `YYYY-MM-DD`), earliest first. Core filters before it limits, so
 * the oldest are never crowded out. Null on failure.
 */
export function loadFollowUps(today: string): Promise<FollowUpsPage | null> {
  return coreClient
    .getContacts({
      followUpBy: today,
      sort: "followUpAt",
      direction: "asc",
      limit: FOLLOW_UPS_LIMIT,
    })
    .then(({ data, meta }) => ({
      rows: data.flatMap((contact) =>
        contact.followUpAt
          ? [
              {
                id: contact.id,
                name: contact.name,
                kind: contact.kind,
                avatarUrl: contact.avatarUrl,
                nextStep: contact.nextStep,
                followUpAt: contact.followUpAt,
              },
            ]
          : [],
      ),
      total: meta.pagination.total,
    }))
    .catch((error: unknown) => {
      console.warn("Home follow-ups failed", { error });
      return null;
    });
}

/**
 * Home's "Follow-ups": contacts the reader meant to get back to by today.
 * Opening one goes to the contact; it does not mark the follow-up done.
 * Renders nothing when none are due.
 */
export async function FollowUps({
  feed,
  today,
}: {
  feed: Promise<FollowUpsPage | null>;
  today: string;
}) {
  const [page, t, format] = await Promise.all([
    feed,
    getTranslations("App.Chat.Landing.FollowUps"),
    getFormatter(),
  ]);
  if (!page || page.rows.length === 0) return null;
  const left = page.total - page.rows.length;

  return (
    <section aria-label={t("title")} data-testid="home-follow-ups">
      <h2 className="text-foreground px-3 pb-2 text-sm font-medium">
        {t("title")}
      </h2>
      <ul className="flex flex-col">
        {page.rows.map((row) => {
          const overdue = row.followUpAt < today;
          const date = format.dateTime(
            dueDayDate(row.followUpAt),
            DUE_DAY_FORMAT,
          );
          return (
            <li key={row.id} data-testid="home-follow-up-row">
              <Link
                href={`/contacts?contact=${encodeURIComponent(row.id)}`}
                className="hover:bg-accent focus-visible:ring-ring flex min-w-0 items-center gap-3 rounded-md px-3 py-2 outline-none transition-colors focus-visible:ring-2"
              >
                <ContactAvatar
                  name={row.name}
                  src={row.avatarUrl}
                  kind={row.kind}
                  className="size-5"
                />
                <span className="min-w-0 flex-1 truncate text-sm">
                  <span className="text-foreground">{row.name}</span>
                  {row.nextStep ? (
                    <span className="text-muted-foreground">
                      {t("separator")}
                      {row.nextStep}
                    </span>
                  ) : null}
                </span>
                <time
                  dateTime={row.followUpAt}
                  className={cn(
                    "shrink-0 text-sm",
                    overdue
                      ? "text-foreground font-medium"
                      : "text-muted-foreground",
                  )}
                >
                  {overdue ? t("overdue", { date }) : t("today")}
                </time>
              </Link>
            </li>
          );
        })}
      </ul>
      {left > 0 ? (
        <p className="text-muted-foreground px-3 pt-1 text-sm">
          {t("more", { count: left })}
        </p>
      ) : null}
    </section>
  );
}

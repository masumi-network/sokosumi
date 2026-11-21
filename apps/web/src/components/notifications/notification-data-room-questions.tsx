"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { MessageCircleQuestionMark } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId } from "react";
import {
  usePageListSearch,
  usePageSearchPagination,
  usePageSearchQuery,
} from "@/components/page-list-search";
import { Button, buttonVariants } from "@/components/ui/button";
import { useSession } from "@/lib/auth/auth.client";
import { cn } from "@/lib/utils";
import { useNotificationTimeFormatter } from "@/lib/utils/notification-time";
import {
  dataRoomQuestionHref,
  needsYouDataRoomQuestionsQueryOptions,
} from "@/queries/needs-you-data-room-questions";

/**
 * The unanswered data room questions, shared by the tab count and the rows.
 * `total` counts every one, also those on pages not read yet.
 */
export function useNeedsYouDataRoomQuestions() {
  const { data: session } = useSession();

  return useInfiniteQuery(
    needsYouDataRoomQuestionsQueryOptions(
      session?.user.id,
      session?.session.activeOrganizationId ?? null,
    ),
  );
}

/** The document's own name: a question's path is relative to its room. */
function documentName(path: string): string {
  return path.split("/").at(-1) || path;
}

interface NotificationDataRoomQuestionsProps {
  /** Closes the surrounding panel, which navigation does not unmount. */
  onNavigate?: () => void;
}

/**
 * Questions viewers asked in the reader's data rooms that nobody has
 * answered, as Needs you lists them, newest first. Each row is one link to
 * the room's Questions tab, opened on that question, which is where the
 * answer is given; answering there takes the row away. Older questions come
 * a page at a time below, so every counted question can be reached.
 */
export function NotificationDataRoomQuestions({
  onNavigate,
}: NotificationDataRoomQuestionsProps) {
  const t = useTranslations("Components.NotificationCenter.DataRoomQuestions");
  const tCenter = useTranslations("Components.NotificationCenter");
  const formatTime = useNotificationTimeFormatter();
  const {
    data,
    isError,
    refetch,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    isFetching,
  } = useNeedsYouDataRoomQuestions();
  // The panel and the page can both be open, so the heading id is per frame.
  const headingId = useId();
  const query = usePageSearchQuery();
  const questions = usePageListSearch(
    data?.pages.flatMap((page) => page.questions) ?? [],
    (question) => ({
      primary: [question.body],
      secondary: [
        question.name,
        question.email,
        question.path,
        question.roomName,
      ],
    }),
  );
  usePageSearchPagination(
    data?.pages.at(-1)?.nextCursor,
    isFetching,
    fetchNextPage,
  );

  if (isError) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 p-3">
        <p className="text-muted-foreground text-sm">{t("loadError")}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void refetch()}
        >
          {tCenter("retry")}
        </Button>
      </div>
    );
  }

  const total = data?.pages[0]?.total ?? 0;
  if (total === 0 || (query && !questions.length && !hasNextPage)) {
    return null;
  }

  return (
    <section aria-labelledby={headingId}>
      <div className="px-3 pt-3 pb-1">
        <h2 id={headingId} className="text-sm font-medium">
          {t("heading", { count: total })}
        </h2>
      </div>
      <ul className="divide-border divide-y">
        {questions.map((question) => (
          <li key={question.id}>
            <Link
              href={dataRoomQuestionHref(question)}
              onClick={onNavigate}
              className="hover:bg-accent focus-visible:ring-ring flex items-start gap-3 p-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset"
            >
              <span
                aria-hidden
                className="bg-quinary flex size-8 shrink-0 items-center justify-center rounded-full"
              >
                <MessageCircleQuestionMark className="size-4" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="line-clamp-2 text-sm font-medium text-pretty break-words">
                  {question.body}
                </span>
                <span className="text-muted-foreground text-xs break-words">
                  {t("byline", {
                    who: question.name ?? question.email,
                    document: documentName(question.path),
                    room: question.roomName,
                  })}
                  {" · "}
                  <span className="tabular-nums">
                    {formatTime(question.createdAt)}
                  </span>
                </span>
              </span>
              <span
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "pointer-events-none shrink-0",
                )}
              >
                {t("action")}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {hasNextPage ? (
        <div className="flex justify-center p-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            {t("showOlder")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

"use client";

import type { DataRoomQuestion, DataRoomTreeRow } from "@sokosumi/core-client";
import { useQuery } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  answerDataRoomQuestion,
  dataRoomRefusal,
  fetchDataRoomQuestions,
} from "@/lib/utils/data-room.client";
import type { FileStore } from "@/lib/utils/file-search.client";
import { rowLabel } from "./data-room-activity";

/** Viewers' questions about documents, each answerable in place. */
export function DataRoomQuestions({
  store,
  roomId,
  rows,
}: {
  store: FileStore;
  roomId: string;
  rows: DataRoomTreeRow[];
}) {
  const t = useTranslations("App.Drive.DataRoom.Questions");
  const query = useQuery({
    queryKey: ["drive", "data-room", roomId, "questions", store],
    queryFn: () => fetchDataRoomQuestions({ store, roomId }),
  });

  if (query.isError)
    return (
      <p className="text-muted-foreground p-4 text-sm" role="alert">
        {t("loadFailed")}
      </p>
    );
  const questions = query.data ?? [];
  if (questions.length === 0)
    return (
      <p className={cn(HOLDER_ITEM_CLASS, "text-muted-foreground p-4 text-sm")}>
        {query.isPending ? t("loading") : t("empty")}
      </p>
    );
  return (
    <ul className="grid gap-2">
      {questions.map((question) => (
        <QuestionItem
          key={question.id}
          store={store}
          roomId={roomId}
          question={question}
          label={rowLabel(rows, question.path)}
          onAnswered={() => void query.refetch()}
        />
      ))}
    </ul>
  );
}

function QuestionItem({
  store,
  roomId,
  question,
  label,
  onAnswered,
}: {
  store: FileStore;
  roomId: string;
  question: DataRoomQuestion;
  label: string;
  onAnswered: () => void;
}) {
  const t = useTranslations("App.Drive.DataRoom.Questions");
  const format = useFormatter();
  const [answer, setAnswer] = useState(question.answer ?? "");
  const [busy, setBusy] = useState(false);

  return (
    <li className={cn(HOLDER_ITEM_CLASS, "grid gap-2 p-4")}>
      <p className="text-muted-foreground text-xs">
        {t("byline", {
          who: question.name ?? question.email,
          path: label,
          when: format.relativeTime(new Date(question.createdAt)),
        })}
      </p>
      <p className="text-sm">{question.body}</p>
      <form
        className="grid gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!answer.trim()) return;
          setBusy(true);
          try {
            await answerDataRoomQuestion({
              store,
              roomId,
              questionId: question.id,
              answer,
            });
            toast.success(t("answered"));
            onAnswered();
          } catch (error) {
            toast.error(dataRoomRefusal(error) ?? t("answerFailed"));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Textarea
          rows={2}
          aria-label={t("answerLabel")}
          placeholder={t("answerPlaceholder")}
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          className="justify-self-start"
          loading={busy}
          disabled={!answer.trim() || answer === question.answer}
        >
          {question.answer ? t("updateAnswer") : t("answer")}
        </Button>
      </form>
    </li>
  );
}

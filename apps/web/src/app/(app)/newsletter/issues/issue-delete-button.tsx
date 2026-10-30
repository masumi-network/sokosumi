"use client";

import type { NewsletterIssue } from "@sokosumi/core-client";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { deleteNewsletterIssue } from "@/lib/actions/newsletter/issues";

export function IssueDeleteButton({
  projectId,
  issue,
}: {
  projectId: string;
  issue: NewsletterIssue;
}) {
  const t = useTranslations("App.Projects.Newsletter.Issues");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function handleDelete() {
    setPending(true);
    setError("");
    try {
      const result = await deleteNewsletterIssue({
        projectId,
        issueId: issue.id,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError(t("Delete.error"));
    } finally {
      setPending(false);
    }
  }
  return (
    <AlertDialog
      open={open}
      onOpenChange={(value) => {
        if (!pending) {
          setOpen(value);
          setError("");
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-10 md:size-8"
          aria-label={t("Delete.action")}
        >
          <Trash2 />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("Delete.title")}</AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            {t("Delete.description", { subject: issue.subject })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p role="alert" className="text-foreground text-sm">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t("Delete.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            loading={pending}
            className="bg-semantic-destructive-solid text-semantic-destructive-foreground hover:bg-destructive-hover"
            onClick={(event) => {
              event.preventDefault();
              void handleDelete();
            }}
          >
            {t("Delete.action")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

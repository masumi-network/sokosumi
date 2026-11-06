"use client";

import {
  type NewsletterSubscriber,
  NewsletterSubscriberStatus,
} from "@sokosumi/core-client";
import { MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  changeNewsletterSubscriberStatus,
  removeNewsletterSubscriber,
} from "@/lib/actions/newsletter/subscribers";

interface SubscriberActionsProps {
  projectId: string;
  subscriber: NewsletterSubscriber;
}

export function SubscriberActions({
  projectId,
  subscriber,
}: SubscriberActionsProps) {
  const t = useTranslations("App.Projects.Newsletter.Subscribers");
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [unsubscribing, setUnsubscribing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const canUnsubscribe =
    subscriber.status === NewsletterSubscriberStatus.ACTIVE;
  const canRemove =
    canUnsubscribe || subscriber.status === NewsletterSubscriberStatus.PENDING;

  function openConfirm(unsubscribe: boolean) {
    setUnsubscribing(unsubscribe);
    setError("");
    setConfirmOpen(true);
  }

  async function handleStatus() {
    if (!canUnsubscribe) return;
    setPending(true);
    setError("");
    try {
      const result = await changeNewsletterSubscriberStatus({
        projectId,
        subscriberId: subscriber.id,
        status: NewsletterSubscriberStatus.UNSUBSCRIBED,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      toast.success(t("unsubscribed"));
      setConfirmOpen(false);
      router.refresh();
    } catch {
      setError(t("updateError"));
    } finally {
      setPending(false);
    }
  }

  async function handleRemove() {
    setPending(true);
    setError("");
    try {
      const result = await removeNewsletterSubscriber({
        projectId,
        subscriberId: subscriber.id,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      toast.success(t("Remove.success"));
      setConfirmOpen(false);
      router.refresh();
    } catch {
      setError(t("Remove.error"));
    } finally {
      setPending(false);
    }
  }

  if (!canRemove) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={pending}>
          <Button
            ref={trigger}
            size="icon"
            variant="ghost"
            className="size-10 md:size-8"
            aria-label={t("rowActions", { email: subscriber.email })}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canUnsubscribe ? (
            <DropdownMenuItem onSelect={() => openConfirm(true)}>
              {t("unsubscribe")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => openConfirm(false)}
          >
            {t("remove")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!pending) setConfirmOpen(open);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {unsubscribing ? t("Unsubscribe.title") : t("Remove.title")}
            </AlertDialogTitle>
            <AlertDialogDescription className="break-all">
              {unsubscribing
                ? t("Unsubscribe.description", { email: subscriber.email })
                : t("Remove.description", { email: subscriber.email })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? (
            <p role="alert" className="text-foreground text-sm">
              {error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              {t("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              loading={pending}
              className="bg-semantic-destructive-solid text-semantic-destructive-foreground hover:bg-destructive-hover"
              onClick={(event) => {
                event.preventDefault();
                void (unsubscribing ? handleStatus() : handleRemove());
              }}
            >
              {unsubscribing ? t("unsubscribe") : t("remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

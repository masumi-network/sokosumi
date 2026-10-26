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
  const [removeOpen, setRemoveOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const errorToastOptions = {
    duration: Infinity,
    cancel: { label: t("dismiss"), onClick: () => undefined },
  };
  const nextStatus =
    subscriber.status === NewsletterSubscriberStatus.ACTIVE
      ? NewsletterSubscriberStatus.UNSUBSCRIBED
      : null;
  const canRemove =
    subscriber.status === NewsletterSubscriberStatus.ACTIVE ||
    subscriber.status === NewsletterSubscriberStatus.PENDING;

  async function handleStatus() {
    if (!nextStatus) return;
    setPending(true);
    try {
      const result = await changeNewsletterSubscriberStatus({
        projectId,
        subscriberId: subscriber.id,
        status: nextStatus,
      });
      if (!result.ok) {
        toast.error(result.error.message, errorToastOptions);
        return;
      }
      toast.success(t("unsubscribed"));
      router.refresh();
    } catch {
      toast.error(t("updateError"), errorToastOptions);
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
      setRemoveOpen(false);
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
            loading={pending && !removeOpen}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {nextStatus ? (
            <DropdownMenuItem onSelect={() => void handleStatus()}>
              {t("unsubscribe")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              setError("");
              setRemoveOpen(true);
            }}
          >
            {t("remove")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog
        open={removeOpen}
        onOpenChange={(open) => {
          if (!pending) setRemoveOpen(open);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Remove.title")}</AlertDialogTitle>
            <AlertDialogDescription className="break-all">
              {t("Remove.description", { email: subscriber.email })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? (
            <p role="alert" className="text-semantic-destructive-label text-sm">
              {error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              {t("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              loading={pending}
              className="bg-semantic-destructive-solid text-destructive-foreground hover:bg-destructive-hover"
              onClick={(event) => {
                event.preventDefault();
                void handleRemove();
              }}
            >
              {t("remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

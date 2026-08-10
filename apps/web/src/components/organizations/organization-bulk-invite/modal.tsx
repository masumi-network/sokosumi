"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type Dispatch,
  type FormEvent,
  type SetStateAction,
  useState,
} from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { inviteOrganizationMembersBulk } from "@/lib/actions/organization";

interface OrganizationBulkInviteModalProps {
  open: boolean;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
  organizationId: string;
}

type BulkInviteResultRow = {
  email: string;
  status: "sent" | "failed";
};

export default function OrganizationBulkInviteModal({
  open,
  onOpenChange,
  organizationId,
}: OrganizationBulkInviteModalProps) {
  const t = useTranslations("Components.Organizations.BulkInviteModal");
  const router = useRouter();
  const [rawEmails, setRawEmails] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [results, setResults] = useState<BulkInviteResultRow[]>([]);
  const hasResults = results.length > 0;

  const handleClose = () => {
    setRawEmails("");
    setResults([]);
    onOpenChange(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (isSubmitting) return;
    if (!nextOpen) {
      handleClose();
      return;
    }
    onOpenChange(nextOpen);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setResults([]);

    try {
      const result = await inviteOrganizationMembersBulk({
        organizationId,
        rawEmails,
      });

      if (!result.ok) {
        toast.error(result.error.message ?? t("error"));
        return;
      }

      const nextResults = result.value.results;
      const sentCount = nextResults.filter(
        (row) => row.status === "sent",
      ).length;
      const failedCount = nextResults.length - sentCount;

      setResults(nextResults);
      setRawEmails("");

      if (sentCount > 0) {
        router.refresh();
      }

      const summaryMessage = t("summary", {
        sent: sentCount,
        failed: failedCount,
      });
      if (sentCount === 0) {
        toast.error(summaryMessage);
      } else if (failedCount > 0) {
        toast.warning(summaryMessage);
      } else {
        toast.success(summaryMessage);
      }
    } catch (_error) {
      toast.error(t("error"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[80svh] w-[calc(100vw-2rem)] max-w-lg! overflow-hidden">
        <DialogTitle className="text-center">{t("title")}</DialogTitle>
        <DialogDescription className="text-center">
          {t("description")}
        </DialogDescription>
        {!hasResults ? (
          <form onSubmit={handleSubmit} className="min-w-0 space-y-4">
            <div className="min-w-0 space-y-2">
              <Label htmlFor="bulk-invite-emails">{t("label")}</Label>
              <Textarea
                id="bulk-invite-emails"
                value={rawEmails}
                onChange={(event) => setRawEmails(event.target.value)}
                placeholder={t("placeholder")}
                disabled={isSubmitting}
                className="max-h-36 min-h-36 max-w-full resize-none overflow-y-auto"
              />
              <p className="text-muted-foreground text-sm">{t("hint")}</p>
            </div>
            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              {t("submit")}
            </Button>
          </form>
        ) : null}
        {hasResults ? (
          <div className="max-h-56 overflow-y-auto rounded-md border">
            <ul className="divide-y">
              {results.map((row) => (
                <li
                  key={`${row.email}-${row.status}`}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <span className="truncate text-sm">{row.email}</span>
                  <Badge
                    variant={row.status === "sent" ? "secondary" : "outline"}
                  >
                    {row.status === "sent"
                      ? t("Status.sent")
                      : t("Status.failed")}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {hasResults ? (
          <Button type="button" onClick={handleClose} className="w-full">
            {t("close")}
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

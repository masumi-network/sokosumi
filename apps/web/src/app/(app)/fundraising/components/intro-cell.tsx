"use client";
import type {
  FundraisingConnector,
  FundraisingIntroAskResult,
  FundraisingPipeline,
  FundraisingProspect,
} from "@sokosumi/core-client";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { coreErrorOf } from "@/app/contacts/contacts-view";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/lib/auth/auth.client";
import { fundraisingService } from "@/lib/services/fundraising.client";
import { type IntroAction, introAction } from "../fundraising-view";
import {
  FUNDRAISING_KEY,
  useFundraisingOrganization,
  useProspectUpdate,
} from "../use-fundraising";
import { pathsKey } from "./warm-paths";

const GMAIL_DRAFTS = "https://mail.google.com/mail/#drafts";
/** Below this, the tie is weak enough to say so before asking (Walk: a strong cold mail beats a weak warm one). */
const WEAK_TIE = 30;

export type AskRequest = {
  connector: FundraisingConnector;
  strength: number;
};

/**
 * One line and one button per investor: the intro in flight with its next
 * click, else the best path and "Draft the ask", else the viewer's own way
 * in. The sheet reuses it above Outreach.
 */
export function IntroCell({
  prospect,
  pipeline,
  now,
  onOpenSheet,
}: {
  prospect: FundraisingProspect;
  pipeline: FundraisingPipeline;
  now: Date;
  onOpenSheet?: () => void;
}) {
  const t = useTranslations("App.Fundraising.intro");
  const format = useFormatter();
  const me = useSession().data?.user.id ?? null;
  const update = useProspectUpdate();
  const [ask, setAsk] = useState<AskRequest | null>(null);
  const action = introAction(prospect, me);
  const when = (date: Date) => format.relativeTime(date, now);

  return (
    <div className="grid gap-1.5 text-sm" data-testid="intro-cell">
      <ActionLine action={action} prospect={prospect} when={when} />
      <div className="flex flex-wrap gap-1.5">
        {action.kind === "asked" ? (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() =>
                void update.updateProspect(prospect, {
                  intro: { state: "MADE" },
                })
              }
            >
              {t("introMade")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() =>
                void update.updateProspect(prospect, {
                  intro: { state: "DECLINED" },
                })
              }
            >
              {t("declined")}
            </Button>
          </>
        ) : action.kind === "made" ? (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() =>
                void update.updateProspect(prospect, { stage: "MEETING" })
              }
            >
              {t("meetingBooked")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() =>
                void update.updateProspect(prospect, { stage: "PASSED" })
              }
            >
              {t("passed")}
            </Button>
          </>
        ) : action.kind === "ask" ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            data-testid="draft-ask"
            onClick={() =>
              setAsk({
                connector: action.connector,
                strength: action.path.strength,
              })
            }
          >
            {t("draftAsk")}
          </Button>
        ) : action.kind === "write" && onOpenSheet ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            onClick={onOpenSheet}
          >
            {t("writeDraft")}
          </Button>
        ) : null}
      </div>
      {ask ? (
        <IntroAskDialog
          prospect={prospect}
          pipeline={pipeline}
          ask={ask}
          onClose={() => setAsk(null)}
        />
      ) : null}
    </div>
  );
}

function ActionLine({
  action,
  prospect,
  when,
}: {
  action: IntroAction;
  prospect: FundraisingProspect;
  when: (date: Date) => string;
}) {
  const t = useTranslations("App.Fundraising.intro");
  const investor = prospect.contact.name;
  if (action.kind === "asked")
    return (
      <p className="text-pretty">
        {t("asked", { who: action.via.name, when: when(action.at) })}
      </p>
    );
  if (action.kind === "made")
    return (
      <p className="text-pretty">
        {t("made", { who: action.via.name, when: when(action.at) })}
      </p>
    );
  if (action.kind === "write")
    return <p className="text-muted-foreground text-pretty">{t("youKnow")}</p>;
  if (action.kind === "ask") {
    const { path, connector, viaName } = action;
    const line =
      path.kind === "portfolio"
        ? t("askPortfolio", {
            who: connector.name,
            company: path.company?.name ?? "",
          })
        : path.kind === "fund"
          ? t("askFund", {
              who: connector.name,
              company: path.company?.name ?? "",
            })
          : t("askDirect", { who: connector.name, investor });
    return (
      <p className="text-pretty">
        {line}
        {viaName ? (
          <span className="text-muted-foreground">
            {" "}
            {t("via", { who: viaName })}
          </span>
        ) : null}
        {action.declined ? (
          <span className="text-muted-foreground">
            {" "}
            {t("declinedBefore", { who: action.declined.name })}
          </span>
        ) : null}
      </p>
    );
  }
  return (
    <p className="text-muted-foreground text-pretty">
      {action.declined
        ? t("declinedBy", { who: action.declined.name })
        : (prospect.contact.nextStep ?? t("noPath"))}
    </p>
  );
}

/** Writes the two drafts; the data room invite is off until ticked. */
export function IntroAskDialog({
  prospect,
  pipeline,
  ask,
  onClose,
}: {
  prospect: FundraisingProspect;
  pipeline: FundraisingPipeline;
  ask: AskRequest;
  onClose: () => void;
}) {
  const t = useTranslations("App.Fundraising.intro");
  const cache = useQueryClient();
  const organizationId = useFundraisingOrganization();
  const room = pipeline.rooms[0] ?? null;
  const [invite, setInvite] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FundraisingIntroAskResult | null>(null);
  const { connector } = ask;
  const investor = prospect.contact.name;

  async function write() {
    setBusy(true);
    try {
      const made = await fundraisingService.introAsk(prospect.contact.id, {
        ...(connector.kind === "contact"
          ? { viaContactId: connector.id }
          : { viaUserId: connector.id }),
        inviteToRoomId: invite && room ? room.id : undefined,
        note: note.trim() || undefined,
      });
      setResult(made);
      void cache.invalidateQueries({
        queryKey: [organizationId, ...FUNDRAISING_KEY],
      });
      void cache.invalidateQueries({
        queryKey: [organizationId, ...pathsKey(prospect.contact.id)],
      });
      toast.success(t("done", { mailbox: made.provider }));
    } catch (error) {
      toast.error(coreErrorOf(error).message ?? t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("dialogTitle", { who: connector.name, investor })}
          </DialogTitle>
          <DialogDescription>
            {t("dialogDescription", { who: connector.name })}
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="grid gap-3 text-sm" data-testid="intro-ask-result">
            <div>
              <p className="font-medium">{result.ask.subject}</p>
              <p className="text-muted-foreground text-xs">
                {t("askTo", { to: result.ask.to })}
              </p>
            </div>
            <div>
              <p className="font-medium">{result.forwardable.subject}</p>
              <p className="text-muted-foreground line-clamp-4 whitespace-pre-line">
                {result.forwardable.body}
              </p>
              <p className="text-muted-foreground text-xs">
                {t("noteTo", { to: result.forwardable.to })}
              </p>
            </div>
            <DialogFooter>
              <Button asChild variant="outline">
                <a href={GMAIL_DRAFTS} target="_blank" rel="noreferrer">
                  {t("openDrafts")}
                  <ExternalLink aria-hidden className="size-4" />
                </a>
              </Button>
              <Button onClick={onClose}>{t("close")}</Button>
            </DialogFooter>
          </div>
        ) : !pipeline.mailbox ? (
          <p className="text-muted-foreground text-sm text-pretty">
            {t("noMailbox")}{" "}
            <Link href="/soko-bots" className="underline underline-offset-2">
              {t("connect")}
            </Link>
          </p>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void write();
            }}
          >
            {ask.strength < WEAK_TIE ? (
              <p className="text-sm text-pretty">
                {t("weakTie", { who: connector.name })}
              </p>
            ) : null}
            {room ? (
              <Label className="flex items-center gap-2 text-sm font-normal">
                <Checkbox
                  checked={invite}
                  onCheckedChange={(value) => setInvite(value === true)}
                />
                {t("inviteRoom", { investor, room: room.title })}
              </Label>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor="intro-note">{t("noteLabel")}</Label>
              <Textarea
                id="intro-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t("notePlaceholder")}
                rows={2}
                maxLength={1000}
              />
            </div>
            <p className="text-muted-foreground text-xs">{t("neverSends")}</p>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={onClose}
              >
                {t("cancel")}
              </Button>
              <Button type="submit" loading={busy} data-testid="write-both">
                {t("write")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

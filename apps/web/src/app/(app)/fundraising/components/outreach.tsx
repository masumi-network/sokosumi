"use client";
import type {
  FundraisingDraftResult,
  FundraisingPath,
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fundraisingService } from "@/lib/services/fundraising.client";
import {
  FUNDRAISING_KEY,
  useFundraisingOrganization,
} from "../use-fundraising";
import { pathsKey } from "./warm-paths";

const GMAIL_DRAFTS = "https://mail.google.com/mail/#drafts";
const DIRECT = "__direct__";

/**
 * A short mail for this investor, written from what the raise knows and put
 * in the owner's own mailbox as a draft. Sokosumi never sends it.
 */
export function Outreach({
  prospect,
  pipeline,
  now,
}: {
  prospect: FundraisingProspect;
  pipeline: FundraisingPipeline;
  now: Date;
}) {
  const t = useTranslations("App.Fundraising.outreach");
  const format = useFormatter();
  const cache = useQueryClient();
  const organizationId = useFundraisingOrganization();
  const contactId = prospect.contact.id;
  const paths = cache.getQueryData<{ paths: FundraisingPath[] }>([
    organizationId,
    ...pathsKey(contactId),
  ]);
  const intros = (paths?.paths ?? []).filter(
    (path) => path.through?.email && path.via,
  );
  const room = pipeline.rooms[0] ?? null;
  const hasEmail = prospect.contact.channels.some((c) => c.type === "EMAIL");
  const [kind, setKind] = useState<"intro" | "follow_up">(
    prospect.contact.lastContactAt ? "follow_up" : "intro",
  );
  const [via, setVia] = useState<string>(DIRECT);
  const [invite, setInvite] = useState(Boolean(room) && !prospect.dataRoom);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FundraisingDraftResult | null>(null);
  const mailbox = pipeline.mailbox;

  async function draft() {
    setBusy(true);
    try {
      const made = await fundraisingService.draft(contactId, {
        kind,
        viaContactId: via === DIRECT ? undefined : via,
        inviteToRoomId: invite && room ? room.id : undefined,
        note: note.trim() || undefined,
      });
      setResult(made);
      void cache.invalidateQueries({
        queryKey: [organizationId, ...FUNDRAISING_KEY],
      });
      toast.success(t("drafted", { mailbox: made.provider }));
    } catch (error) {
      toast.error(coreErrorOf(error).message ?? t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2" data-testid="outreach">
      <span className="text-muted-foreground text-xs font-medium">
        {t("title")}
      </span>
      {!mailbox ? (
        <p className="text-muted-foreground text-sm text-pretty">
          {t("noMailbox")}{" "}
          <Link href="/soko-bots" className="underline underline-offset-2">
            {t("connect")}
          </Link>
        </p>
      ) : result ? (
        <div className="grid gap-2 text-sm" data-testid="outreach-result">
          <p className="font-medium">{result.subject}</p>
          <p className="text-muted-foreground line-clamp-4 whitespace-pre-line">
            {result.body}
          </p>
          <p className="text-muted-foreground text-xs">
            {t("inMailbox", { mailbox: result.provider, to: result.to })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <a href={GMAIL_DRAFTS} target="_blank" rel="noreferrer">
                {t("openDrafts")}
                <ExternalLink aria-hidden className="size-4" />
              </a>
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setResult(null)}>
              {t("another")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          {prospect.lastDraftAt ? (
            <p className="text-muted-foreground text-xs">
              {t("lastDraft", {
                subject: prospect.lastDraftSubject ?? "",
                when: format.relativeTime(new Date(prospect.lastDraftAt), now),
              })}
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={kind}
              onValueChange={(value) =>
                setKind(value === "follow_up" ? "follow_up" : "intro")
              }
            >
              <SelectTrigger size="sm" aria-label={t("kind")}>
                {t(`kinds.${kind}`)}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="intro">{t("kinds.intro")}</SelectItem>
                <SelectItem value="follow_up">
                  {t("kinds.follow_up")}
                </SelectItem>
              </SelectContent>
            </Select>
            <Select value={via} onValueChange={setVia}>
              <SelectTrigger size="sm" aria-label={t("via")}>
                <span className="truncate">
                  {via === DIRECT
                    ? t("direct")
                    : t("viaName", {
                        name:
                          intros.find((p) => p.through?.id === via)?.through
                            ?.name ?? "",
                      })}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DIRECT}>{t("direct")}</SelectItem>
                {intros.map((path) =>
                  path.through ? (
                    <SelectItem key={path.through.id} value={path.through.id}>
                      {t("viaName", { name: path.through.name })}
                    </SelectItem>
                  ) : null,
                )}
              </SelectContent>
            </Select>
          </div>
          {room ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={invite}
                disabled={!hasEmail}
                onCheckedChange={(checked) => setInvite(checked === true)}
              />
              {prospect.dataRoom
                ? t("linkRoom", { room: room.title })
                : t("inviteRoom", { room: room.title })}
            </label>
          ) : null}
          <div className="grid gap-1">
            <Label
              htmlFor="outreach-note"
              className="text-muted-foreground text-xs"
            >
              {t("noteLabel")}
            </Label>
            <Textarea
              id="outreach-note"
              rows={2}
              maxLength={1000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t("notePlaceholder")}
            />
          </div>
          {!hasEmail && via === DIRECT ? (
            <p className="text-muted-foreground text-xs">{t("noEmail")}</p>
          ) : null}
          <Button
            size="sm"
            loading={busy}
            disabled={!hasEmail && via === DIRECT}
            onClick={() => void draft()}
            data-testid="draft-outreach"
          >
            {t("draft", { mailbox: mailbox.provider })}
          </Button>
          <p className="text-muted-foreground text-xs">{t("neverSends")}</p>
        </div>
      )}
    </div>
  );
}

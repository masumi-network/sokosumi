"use client";
import type {
  FundraisingPipeline,
  FundraisingProspect,
  FundraisingStage,
} from "@sokosumi/core-client";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useState } from "react";
import {
  ContactAvatar,
  ReplyChip,
} from "@/app/contacts/components/contact-visuals";
import { InlineField } from "@/app/contacts/components/inline-field";
import { primaryEmail } from "@/app/contacts/contacts-view";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import {
  countByStage,
  FUNDRAISING_STAGES,
  sortProspects,
} from "../fundraising-view";
import {
  useFundraisingPipeline,
  useOrganizationMembers,
  useProspectUpdate,
} from "../use-fundraising";
import { OwnerSelect, StageSelect } from "./prospect-controls";
import { ProspectSheet } from "./prospect-sheet";

const ALL = "all";
const CELL = "px-3 py-2";

/** The investor's data room record in a few words. */
export function RoomSummary({
  visit,
  now,
}: {
  visit: FundraisingProspect["dataRoom"];
  now: Date;
}) {
  const t = useTranslations("App.Fundraising.room");
  const format = useFormatter();
  if (!visit)
    return <span className="text-muted-foreground">{t("notInvited")}</span>;
  if (visit.revoked)
    return <span className="text-muted-foreground">{t("revoked")}</span>;
  if (!visit.lastVisitAt)
    return (
      <span className="text-muted-foreground">
        {t("invited", {
          when: format.relativeTime(new Date(visit.invitedAt), now),
        })}
      </span>
    );
  return (
    <span className="flex min-w-0 flex-col">
      <span className="tabular-nums">
        {t("opened", { views: visit.views })}
      </span>
      <span className="text-muted-foreground truncate text-xs">
        {format.relativeTime(new Date(visit.lastVisitAt), now)}
      </span>
    </span>
  );
}

export function FundraisingBoard({
  initialData,
}: {
  initialData: FundraisingPipeline;
}) {
  const t = useTranslations("App.Fundraising");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const { data } = useFundraisingPipeline(initialData);
  const members = useOrganizationMembers();
  const update = useProspectUpdate();
  const [stageFilter, setStageFilter] = useState<FundraisingStage | typeof ALL>(
    ALL,
  );
  const [openId, setOpenId] = useState<string | null>(null);

  const pipeline = data ?? initialData;
  const counts = countByStage(pipeline.prospects);
  const rows = sortProspects(
    stageFilter === ALL
      ? pipeline.prospects
      : pipeline.prospects.filter((p) => p.stage === stageFilter),
  );
  const open = pipeline.prospects.find((p) => p.contact.id === openId) ?? null;
  const room = pipeline.rooms[0] ?? null;

  if (!pipeline.list)
    return (
      <Empty title={t("noListTitle")} body={t("noList")}>
        <Button asChild variant="outline" size="sm">
          <Link href="/contacts">{t("openContacts")}</Link>
        </Button>
      </Empty>
    );

  return (
    <div className="flex min-w-0 flex-col gap-4 p-4">
      <header className="flex min-w-0 flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold tracking-tight">{t("title")}</h2>
          <p className="text-muted-foreground text-sm">
            {t("subtitle", { count: pipeline.prospects.length })}
            {room ? ` · ${room.title}` : ""}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/contacts?list=${encodeURIComponent(pipeline.list.id)}`}>
            {t("openList")}
            <ArrowUpRight aria-hidden className="size-4" />
          </Link>
        </Button>
      </header>

      <ToggleGroup
        type="single"
        aria-label={t("columns.stage")}
        value={stageFilter}
        onValueChange={(value) => {
          if (value === ALL) setStageFilter(ALL);
          else {
            const stage = FUNDRAISING_STAGES.find((s) => s === value);
            if (stage) setStageFilter(stage);
          }
        }}
        className="justify-start overflow-x-auto"
      >
        <ToggleGroupItem value={ALL} className="flex-none gap-1.5">
          {t("all")}
          <span className="text-muted-foreground text-xs tabular-nums">
            {pipeline.prospects.length}
          </span>
        </ToggleGroupItem>
        {FUNDRAISING_STAGES.map((stage) => (
          <ToggleGroupItem
            key={stage}
            value={stage}
            className="flex-none gap-1.5"
          >
            {t(`stages.${stage}`)}
            <span className="text-muted-foreground text-xs tabular-nums">
              {counts[stage]}
            </span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {pipeline.prospects.length === 0 ? (
        <Empty title={t("emptyTitle")} body={t("empty")}>
          <Button asChild variant="outline" size="sm">
            <Link
              href={`/contacts?list=${encodeURIComponent(pipeline.list.id)}`}
            >
              {t("openList")}
            </Link>
          </Button>
        </Empty>
      ) : (
        <div className="border-border-tertiary overflow-x-auto rounded-xl border">
          <Table className="min-w-[880px] table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={cn(CELL, "w-[24%]")}>
                  {t("columns.investor")}
                </TableHead>
                <TableHead className={cn(CELL, "w-[11%]")}>
                  {t("columns.stage")}
                </TableHead>
                <TableHead className={cn(CELL, "w-[12%]")}>
                  {t("columns.owner")}
                </TableHead>
                <TableHead className={cn(CELL, "w-[19%]")}>
                  {t("columns.nextStep")}
                </TableHead>
                <TableHead className={cn(CELL, "w-[14%]")}>
                  {t("columns.lastTouch")}
                </TableHead>
                <TableHead className={cn(CELL, "w-[13%]")}>
                  {t("columns.dataRoom")}
                </TableHead>
                <TableHead className={cn(CELL, "w-[7%] text-right")}>
                  {t("columns.cheque")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((prospect) => {
                const { contact } = prospect;
                const email = primaryEmail(contact.channels);
                return (
                  <TableRow
                    key={contact.id}
                    data-testid="fundraising-row"
                    className={cn(
                      "cursor-pointer",
                      openId === contact.id && "bg-quinary",
                    )}
                    onClick={() => setOpenId(contact.id)}
                  >
                    <TableCell className={CELL}>
                      <div className="flex min-w-0 items-center gap-3">
                        <ContactAvatar
                          name={contact.name}
                          src={contact.avatarUrl}
                          email={email}
                          kind={contact.kind}
                          className="size-8"
                        />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{contact.name}</p>
                          <p className="text-muted-foreground truncate text-xs">
                            {[contact.organization, contact.role]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell
                      className={CELL}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <StageSelect
                        value={prospect.stage}
                        onChange={(stage) =>
                          void update.updateProspect(prospect, { stage })
                        }
                      />
                    </TableCell>
                    <TableCell
                      className={CELL}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <OwnerSelect
                        owner={prospect.owner}
                        members={members.data ?? []}
                        onChange={(ownerUserId) =>
                          void update.updateProspect(prospect, { ownerUserId })
                        }
                      />
                    </TableCell>
                    <TableCell
                      className={CELL}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <InlineField
                        label={t("columns.nextStep")}
                        value={contact.nextStep ?? ""}
                        placeholder={t("noNextStep")}
                        maxLength={300}
                        displayClassName="text-sm"
                        onSave={(nextStep) =>
                          update.updateContact(prospect, {
                            nextStep: nextStep || null,
                          })
                        }
                      />
                    </TableCell>
                    <TableCell className={cn(CELL, "text-sm")}>
                      {contact.lastContactAt ? (
                        <div className="flex flex-col gap-1">
                          <span className="tabular-nums">
                            {format.relativeTime(
                              new Date(contact.lastContactAt),
                              now,
                            )}
                          </span>
                          {contact.replyState ? (
                            <ReplyChip
                              state={contact.replyState}
                              since={contact.awaitingReplySince}
                              now={now}
                            />
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">
                          {t("noTouch")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className={cn(CELL, "text-sm")}>
                      <RoomSummary visit={prospect.dataRoom} now={now} />
                    </TableCell>
                    <TableCell
                      className={cn(CELL, "text-right text-sm tabular-nums")}
                    >
                      {prospect.ticketSize ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <ProspectSheet
        prospect={open}
        listId={pipeline.list.id}
        members={members.data ?? []}
        now={now}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}

function Empty({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-border-tertiary flex flex-col items-center gap-3 rounded-xl border px-6 py-16 text-center">
      <h3 className="font-semibold">{title}</h3>
      <p className="text-muted-foreground max-w-md text-sm text-pretty">
        {body}
      </p>
      {children}
    </div>
  );
}

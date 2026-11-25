"use client";
import type { FundraisingProspect, Member } from "@sokosumi/core-client";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import {
  ContactAvatar,
  PersonAvatar,
} from "@/app/contacts/components/contact-visuals";
import { InlineField } from "@/app/contacts/components/inline-field";
import { primaryEmail } from "@/app/contacts/contacts-view";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { parseUsd } from "../fundraising-view";
import { useProspectUpdate } from "../use-fundraising";
import { RoomSummary } from "./fundraising-board";
import { OwnerSelect, StageSelect } from "./prospect-controls";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      {children}
    </div>
  );
}

/** One investor's raise record, beside the board. */
export function ProspectSheet({
  prospect,
  listId,
  members,
  now,
  onClose,
}: {
  prospect: FundraisingProspect | null;
  listId: string;
  members: Member[];
  now: Date;
  onClose: () => void;
}) {
  const t = useTranslations("App.Fundraising");
  const format = useFormatter();
  const update = useProspectUpdate();
  const contact = prospect?.contact;
  const email = contact ? primaryEmail(contact.channels) : null;

  return (
    <Sheet open={prospect !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md">
        {prospect && contact ? (
          <>
            <SheetHeader className="gap-3">
              <div className="flex items-center gap-3">
                <ContactAvatar
                  name={contact.name}
                  src={contact.avatarUrl}
                  email={email}
                  kind={contact.kind}
                  className="size-10"
                />
                <div className="min-w-0">
                  <SheetTitle className="truncate">{contact.name}</SheetTitle>
                  <SheetDescription className="truncate">
                    {[contact.organization, contact.role]
                      .filter(Boolean)
                      .join(" · ") || t("sheet.noFund")}
                  </SheetDescription>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link
                    href={`/contacts?list=${encodeURIComponent(listId)}&contact=${encodeURIComponent(contact.id)}`}
                  >
                    {t("sheet.openContact")}
                    <ArrowUpRight aria-hidden className="size-4" />
                  </Link>
                </Button>
                {email ? (
                  <Button asChild variant="outline" size="sm">
                    <a href={`mailto:${email}`}>{email}</a>
                  </Button>
                ) : null}
              </div>
            </SheetHeader>

            <div className="grid gap-5 px-4 pb-6">
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("columns.stage")}>
                  <StageSelect
                    value={prospect.stage}
                    className="w-full"
                    onChange={(stage) =>
                      void update.updateProspect(prospect, { stage })
                    }
                  />
                </Field>
                <Field label={t("columns.owner")}>
                  <OwnerSelect
                    owner={prospect.owner}
                    members={members}
                    className="w-full"
                    onChange={(ownerUserId) =>
                      void update.updateProspect(prospect, { ownerUserId })
                    }
                  />
                </Field>
              </div>

              <Field label={t("sheet.nextStep")}>
                <InlineField
                  label={t("sheet.nextStep")}
                  value={contact.nextStep ?? ""}
                  placeholder={t("noNextStep")}
                  maxLength={300}
                  onSave={(nextStep) =>
                    update.updateContact(prospect, {
                      nextStep: nextStep || null,
                    })
                  }
                />
                <InlineField
                  label={t("sheet.followUp")}
                  type="date"
                  value={contact.followUpAt ?? ""}
                  placeholder={t("sheet.noFollowUp")}
                  display={
                    contact.followUpAt
                      ? format.dateTime(new Date(contact.followUpAt), {
                          dateStyle: "medium",
                        })
                      : undefined
                  }
                  onSave={(followUpAt) =>
                    update.updateContact(prospect, {
                      followUpAt: followUpAt || null,
                    })
                  }
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label={t("sheet.ticket")}>
                  <InlineField
                    label={t("sheet.ticket")}
                    value={prospect.ticketSize ?? ""}
                    placeholder={t("sheet.ticketPlaceholder")}
                    maxLength={120}
                    onSave={(ticketSize) =>
                      update.updateProspect(prospect, {
                        ticketSize: ticketSize || null,
                      })
                    }
                  />
                </Field>
                <Field label={t("sheet.committed")}>
                  <InlineField
                    label={t("sheet.committed")}
                    value={
                      prospect.committedUsd === null
                        ? ""
                        : String(prospect.committedUsd)
                    }
                    display={
                      prospect.committedUsd === null
                        ? undefined
                        : format.number(prospect.committedUsd, {
                            style: "currency",
                            currency: "USD",
                            maximumFractionDigits: 0,
                          })
                    }
                    placeholder={t("sheet.committedPlaceholder")}
                    maxLength={20}
                    onSave={async (text) => {
                      const committedUsd = parseUsd(text);
                      if (committedUsd === undefined) return;
                      await update.updateProspect(prospect, { committedUsd });
                    }}
                  />
                </Field>
              </div>

              <Field label={t("sheet.thesis")}>
                <InlineField
                  label={t("sheet.thesis")}
                  value={prospect.thesis ?? ""}
                  placeholder={t("sheet.thesisPlaceholder")}
                  multiline
                  maxLength={2000}
                  onSave={(thesis) =>
                    update.updateProspect(prospect, { thesis: thesis || null })
                  }
                />
              </Field>

              <Field label={t("sheet.notes")}>
                <InlineField
                  label={t("sheet.notes")}
                  value={prospect.notes ?? ""}
                  placeholder={t("sheet.notesPlaceholder")}
                  multiline
                  maxLength={10_000}
                  onSave={(notes) =>
                    update.updateProspect(prospect, { notes: notes || null })
                  }
                />
              </Field>

              <Field label={t("sheet.knownBy")}>
                {contact.knownBy.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    {t("sheet.knownByNobody")}
                  </p>
                ) : (
                  <ul className="grid gap-1.5">
                    {contact.knownBy.map((person) => (
                      <li
                        key={person.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <PersonAvatar person={person} />
                        <span className="min-w-0 flex-1 truncate">
                          {person.name}
                        </span>
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {t("sheet.touches", {
                            count: person.interactionCount,
                          })}
                          {person.lastInteractionAt
                            ? ` · ${format.relativeTime(new Date(person.lastInteractionAt), now)}`
                            : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Field>

              <Field label={t("columns.dataRoom")}>
                <p className="text-sm">
                  <RoomSummary visit={prospect.dataRoom} now={now} />
                </p>
                {prospect.dataRoom ? (
                  <dl className="text-muted-foreground grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                    <dt>{t("sheet.room")}</dt>
                    <dd className="truncate">{prospect.dataRoom.roomTitle}</dd>
                    <dt>{t("sheet.firstVisit")}</dt>
                    <dd>
                      {prospect.dataRoom.firstVisitAt
                        ? format.dateTime(
                            new Date(prospect.dataRoom.firstVisitAt),
                            "dateTimeMedium",
                          )
                        : "—"}
                    </dd>
                    <dt>{t("sheet.downloads")}</dt>
                    <dd className="tabular-nums">
                      {prospect.dataRoom.downloads}
                    </dd>
                    <dt>{t("sheet.lastOpened")}</dt>
                    <dd className="truncate">
                      {prospect.dataRoom.lastOpened ?? "—"}
                    </dd>
                  </dl>
                ) : null}
                {prospect.dataRoom ? (
                  <Button
                    asChild
                    variant="link"
                    size="sm"
                    className="justify-start px-0"
                  >
                    <Link
                      href={`/drive/data-rooms/${encodeURIComponent(prospect.dataRoom.roomId)}?tab=activity`}
                    >
                      {t("sheet.openRoom")}
                    </Link>
                  </Button>
                ) : null}
              </Field>

              {prospect.source ? (
                <p className="text-muted-foreground text-xs">
                  {t("sheet.source", { source: prospect.source })}
                </p>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

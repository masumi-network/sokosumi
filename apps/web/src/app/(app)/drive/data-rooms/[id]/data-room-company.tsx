"use client";

import type {
  DataRoom,
  DataRoomCompany,
  DataRoomCompanyRepresentative,
  DataRoomTreeRow,
} from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { dataRoomRefusal, updateDataRoom } from "@/lib/utils/data-room.client";
import type { FileStore } from "@/lib/utils/file-search.client";
import { rowLabel } from "./data-room-activity";

const NO_FOLDER = "none";
const EMAIL_FIELDS = new Set<string>(["contactEmail", "eu.email", "uk.email"]);

type TextField = Exclude<
  keyof DataRoomCompany,
  "euRepresentative" | "ukRepresentative" | "websites" | "formationPath"
>;
type RepresentativeField =
  `${"eu" | "uk"}.${keyof DataRoomCompanyRepresentative}`;
type Field = TextField | RepresentativeField | "websites";
type Draft = Record<Field, string>;

/** Each section's fields, in page order; true marks a multi-line field. */
const SECTIONS: { title: string; fields: [Field, boolean?][] }[] = [
  {
    title: "company",
    fields: [
      ["legalName"],
      ["legalForm"],
      ["jurisdiction"],
      ["registrationAuthority"],
      ["registrationNumber"],
      ["incorporated"],
    ],
  },
  {
    title: "addresses",
    fields: [
      ["registeredOffice", true],
      ["registeredAgent"],
      ["businessAddress", true],
      ["contactEmail"],
      ["websites"],
    ],
  },
  {
    title: "euRepresentative",
    fields: [["eu.name"], ["eu.email"], ["eu.address", true]],
  },
  {
    title: "ukRepresentative",
    fields: [["uk.name"], ["uk.email"], ["uk.address", true]],
  },
  {
    title: "taxAndShares",
    fields: [["vatId"], ["ein"], ["authorizedShares"], ["parValue"]],
  },
];

function toDraft(company: DataRoomCompany | null): Draft {
  return {
    legalName: company?.legalName ?? "",
    legalForm: company?.legalForm ?? "",
    jurisdiction: company?.jurisdiction ?? "",
    registrationAuthority: company?.registrationAuthority ?? "",
    registrationNumber: company?.registrationNumber ?? "",
    incorporated: company?.incorporated ?? "",
    registeredOffice: company?.registeredOffice ?? "",
    registeredAgent: company?.registeredAgent ?? "",
    businessAddress: company?.businessAddress ?? "",
    contactEmail: company?.contactEmail ?? "",
    websites: company?.websites?.join(", ") ?? "",
    "eu.name": company?.euRepresentative?.name ?? "",
    "eu.email": company?.euRepresentative?.email ?? "",
    "eu.address": company?.euRepresentative?.address ?? "",
    "uk.name": company?.ukRepresentative?.name ?? "",
    "uk.email": company?.ukRepresentative?.email ?? "",
    "uk.address": company?.ukRepresentative?.address ?? "",
    vatId: company?.vatId ?? "",
    ein: company?.ein ?? "",
    authorizedShares: company?.authorizedShares ?? "",
    parValue: company?.parValue ?? "",
  };
}

/** The details to save; null, which hides the Company page, without a legal name. */
export function companyFromDraft(
  draft: Draft,
  formationPath: string | null,
): DataRoomCompany | null {
  if (!draft.legalName.trim()) return null;
  const representative = (prefix: "eu" | "uk") => ({
    name: draft[`${prefix}.name`],
    email: draft[`${prefix}.email`],
    address: draft[`${prefix}.address`],
  });
  return {
    legalName: draft.legalName,
    legalForm: draft.legalForm,
    jurisdiction: draft.jurisdiction,
    registrationAuthority: draft.registrationAuthority,
    registrationNumber: draft.registrationNumber,
    incorporated: draft.incorporated,
    registeredOffice: draft.registeredOffice,
    registeredAgent: draft.registeredAgent,
    businessAddress: draft.businessAddress,
    contactEmail: draft.contactEmail,
    euRepresentative: representative("eu"),
    ukRepresentative: representative("uk"),
    vatId: draft.vatId,
    ein: draft.ein,
    authorizedShares: draft.authorizedShares,
    parValue: draft.parValue,
    websites: draft.websites
      .split(/[\s,]+/)
      .map((site) => site.trim())
      .filter(Boolean),
    formationPath: formationPath ?? undefined,
  };
}

/** The room's Company page: the company's legal details, shown to viewers. */
export function DataRoomCompanyPanel({
  store,
  room,
  rows,
  onChanged,
}: {
  store: FileStore;
  room: DataRoom;
  rows: DataRoomTreeRow[];
  onChanged: () => void;
}) {
  const t = useTranslations("App.Drive.DataRoom.Company");
  const idPrefix = useId();
  const [draft, setDraft] = useState(() => toDraft(room.company));
  const [formationPath, setFormationPath] = useState(
    room.company?.formationPath ?? NO_FOLDER,
  );
  const [busy, setBusy] = useState(false);
  const folders = rows.filter((row) => row.kind === "folder");

  return (
    <form
      // Without a legal name the save removes the page, so an old malformed email must not block it.
      noValidate={!draft.legalName.trim()}
      className={cn(HOLDER_ITEM_CLASS, "grid gap-6 p-4")}
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
          await updateDataRoom({
            store,
            roomId: room.id,
            settings: {
              company: companyFromDraft(
                draft,
                formationPath === NO_FOLDER ? null : formationPath,
              ),
            },
          });
          toast.success(t("saved"));
          onChanged();
        } catch (error) {
          toast.error(dataRoomRefusal(error) ?? t("saveFailed"));
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-muted-foreground text-sm">{t("intro")}</p>
      {SECTIONS.map((section) => (
        <fieldset key={section.title} className="grid gap-4">
          <legend className="mb-3 text-sm font-medium">
            {t(`sections.${section.title}`)}
          </legend>
          {section.fields.map(([field, multiline]) => {
            const id = `${idPrefix}-${field}`;
            const Control = multiline ? Textarea : Input;
            return (
              <div key={field} className="grid gap-1.5">
                <Label htmlFor={id}>{t(`fields.${field}`)}</Label>
                <Control
                  id={id}
                  rows={multiline ? 3 : undefined}
                  type={EMAIL_FIELDS.has(field) ? "email" : undefined}
                  // An invalid email scrolls into view on save: keep it and its label (2rem)
                  // in view, below the fixed phone header (5rem + top inset, as in app-shell-safe-area).
                  className="scroll-mt-8 max-md:scroll-mt-[calc(7rem+env(safe-area-inset-top))]"
                  value={draft[field]}
                  onChange={(event) =>
                    setDraft((previous) => ({
                      ...previous,
                      [field]: event.target.value,
                    }))
                  }
                />
              </div>
            );
          })}
        </fieldset>
      ))}
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-formation`}>{t("fields.formation")}</Label>
        <Select value={formationPath} onValueChange={setFormationPath}>
          <SelectTrigger
            id={`${idPrefix}-formation`}
            className="w-72 max-w-full"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_FOLDER}>{t("noFolder")}</SelectItem>
            {folders.map((row) => (
              <SelectItem key={row.path} value={row.path}>
                {rowLabel(rows, row.path)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" className="justify-self-start" loading={busy}>
        {t("save")}
      </Button>
    </form>
  );
}

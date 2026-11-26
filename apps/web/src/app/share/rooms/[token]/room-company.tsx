"use client";

import type {
  DataRoomCompany,
  DataRoomCompanyRepresentative,
  DataRoomTreeRow,
} from "@sokosumi/core-client";
import { Folder } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { fileTitle } from "@/lib/team-file";

/** The room's Company page: the company's details as a definition list. */
export function RoomCompany({
  company,
  rows,
  onOpenFolder,
}: {
  company: DataRoomCompany;
  rows: DataRoomTreeRow[];
  onOpenFolder: (path: string) => void;
}) {
  const t = useTranslations("Share.Room.Company");
  const formation = rows.find(
    (row) => row.kind === "folder" && row.path === company.formationPath,
  );
  const entries: [string, ReactNode][] = [
    [t("legalName"), company.legalName],
    [t("legalForm"), company.legalForm],
    [t("jurisdiction"), company.jurisdiction],
    [t("registrationAuthority"), company.registrationAuthority],
    [t("registrationNumber"), company.registrationNumber],
    [t("incorporated"), company.incorporated],
    [t("registeredOffice"), company.registeredOffice],
    [t("registeredAgent"), company.registeredAgent],
    [t("businessAddress"), company.businessAddress],
    [
      t("contactEmail"),
      company.contactEmail && <Mail to={company.contactEmail} />,
    ],
    [t("euRepresentative"), representative(company.euRepresentative)],
    [t("ukRepresentative"), representative(company.ukRepresentative)],
    [t("vatId"), company.vatId],
    [t("ein"), company.ein],
    [t("authorizedShares"), company.authorizedShares],
    [t("parValue"), company.parValue],
    [
      t("websites", { count: company.websites?.length ?? 0 }),
      company.websites?.length ? (
        <span className="grid gap-0.5">
          {company.websites.map((site) => (
            <a
              key={site}
              href={/^https?:\/\//i.test(site) ? site : `https://${site}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline-offset-4 hover:underline"
            >
              {site}
            </a>
          ))}
        </span>
      ) : null,
    ],
    [
      t("formation"),
      formation ? (
        <button
          type="button"
          onClick={() => onOpenFolder(formation.path)}
          className="inline-flex min-h-6 items-center gap-1.5 text-left underline-offset-4 hover:underline"
        >
          <Folder
            aria-hidden
            className="text-muted-foreground size-4 shrink-0"
          />
          <span className="text-muted-foreground tabular-nums">
            {formation.number}
          </span>
          {fileTitle(formation.name)}
        </button>
      ) : null,
    ],
  ];

  return (
    <article className="grid max-w-2xl gap-5 rounded-lg border p-5 md:p-6">
      <h2 className="text-xl font-semibold tracking-tight">{t("title")}</h2>
      <dl className="divide-border grid divide-y text-sm">
        {entries
          .filter(([, value]) => Boolean(value))
          .map(([label, value]) => (
            <div
              key={label}
              className="grid gap-0.5 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[12rem_1fr] sm:gap-4"
            >
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words whitespace-pre-line">
                {value}
              </dd>
            </div>
          ))}
      </dl>
    </article>
  );
}

function Mail({ to }: { to: string }) {
  return (
    <a href={`mailto:${to}`} className="underline-offset-4 hover:underline">
      {to}
    </a>
  );
}

function representative(
  person: DataRoomCompanyRepresentative | undefined,
): ReactNode {
  if (!person?.name) return null;
  return (
    <span className="grid gap-0.5">
      <span>{person.name}</span>
      {person.email ? <Mail to={person.email} /> : null}
      {person.address ? <span>{person.address}</span> : null}
    </span>
  );
}

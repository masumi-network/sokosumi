"use client";

import { Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  parseTeam,
  type Team,
  type TeamNode,
  type TeamPerson,
  teamTree,
} from "@/lib/team-file";
import { cn } from "@/lib/utils";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; team: Team }
  | { status: "failed" };

/**
 * A `*.team.json` file read from `url` and shown as a team.
 *
 * Plain fetch + effect, like `DocumentViewer`: this also renders on the
 * public data room pages, which mount no QueryClientProvider.
 */
export function TeamFileView({ url }: { url: string }) {
  const t = useTranslations("Components.TeamView");
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Failed to fetch team");
        return response.json();
      })
      .then((json: unknown) => {
        const team = parseTeam(json);
        setState(team ? { status: "ready", team } : { status: "failed" });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "failed" });
      });
    return () => controller.abort();
  }, [url]);

  if (state.status === "loading")
    return (
      <div role="status" aria-label={t("loading")}>
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  if (state.status === "failed")
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <Users aria-hidden className="text-muted-foreground size-9" />
        <p className="text-muted-foreground text-sm">{t("failed")}</p>
      </div>
    );
  return <TeamView team={state.team} />;
}

/** One person is a profile page; more are an org chart. */
export function TeamView({ team }: { team: Team }) {
  const [only] = team.people;
  return team.people.length === 1 && only ? (
    <ProfilePage person={only} />
  ) : (
    <OrgChart team={team} />
  );
}

function OrgChart({ team }: { team: Team }) {
  const t = useTranslations("Components.TeamView");
  const [openId, setOpenId] = useState<string | null>(null);
  const open = team.people.find((person) => person.id === openId) ?? null;
  const { roots, advisors } = teamTree(team);

  return (
    <div className="grid gap-6">
      {team.title || team.intro ? (
        <header className="grid gap-2">
          {team.title ? (
            <h2 className="text-2xl font-semibold tracking-tight">
              {team.title}
            </h2>
          ) : null}
          {team.intro ? (
            <p className="text-muted-foreground max-w-prose text-sm">
              {team.intro}
            </p>
          ) : null}
        </header>
      ) : null}

      <div className="hidden overflow-x-auto pb-2 md:block">
        <div className="mx-auto flex w-max items-start gap-8 p-px">
          <div className="flex items-start gap-6">
            {roots.map((root) => (
              <Branch key={root.person.id} node={root} onOpen={setOpenId} />
            ))}
          </div>
          {advisors.length > 0 ? (
            <section className="grid justify-items-center gap-3">
              <h3 className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
                {t("advisors")}
              </h3>
              {advisors.map((person) => (
                <PersonCard
                  key={person.id}
                  person={person}
                  onOpen={setOpenId}
                />
              ))}
            </section>
          ) : null}
        </div>
      </div>

      <ul className="grid gap-3 md:hidden">
        {team.people.map((person) => (
          <li key={person.id}>
            <PersonCard person={person} onOpen={setOpenId} />
          </li>
        ))}
      </ul>

      <Sheet
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) setOpenId(null);
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {open ? <Profile person={open} /> : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** One person and, below them, everyone reporting to them, joined by lines. */
function Branch({
  node,
  onOpen,
}: {
  node: TeamNode;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="flex flex-col items-center">
      <PersonCard person={node.person} onOpen={onOpen} />
      {node.reports.length > 0 ? (
        <>
          <span aria-hidden className="bg-border h-6 w-px" />
          <div className="flex">
            {node.reports.map((report, index) => (
              <div
                key={report.person.id}
                className="relative flex flex-col items-center px-3"
              >
                <span
                  aria-hidden
                  className={cn(
                    "bg-border absolute top-0 h-px",
                    index === 0 ? "left-1/2" : "left-0",
                    index === node.reports.length - 1 ? "right-1/2" : "right-0",
                  )}
                />
                <span aria-hidden className="bg-border h-6 w-px" />
                <Branch node={report} onOpen={onOpen} />
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function PersonCard({
  person,
  onOpen,
}: {
  person: TeamPerson;
  onOpen: (id: string) => void;
}) {
  const hook = person.highlights[0];
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={() => onOpen(person.id)}
      className={cn(
        "bg-background hover:border-foreground focus-visible:ring-ring press flex w-full flex-col items-center gap-1 rounded-xl border p-4 text-center transition-colors focus-visible:ring-2 focus-visible:outline-hidden md:w-48",
        person.advisor && "border-dashed",
      )}
    >
      <Photo person={person} className="mb-2 size-16" />
      <span className="text-sm font-semibold">{person.name}</span>
      <span className="text-muted-foreground text-xs">{person.role}</span>
      {hook ? (
        <span className="text-muted-foreground mt-1 line-clamp-3 text-xs">
          {hook}
        </span>
      ) : null}
    </button>
  );
}

function Photo({
  person,
  className,
}: {
  person: TeamPerson;
  className: string;
}) {
  if (person.photo)
    return (
      <img
        src={person.photo}
        alt=""
        className={cn("rounded-full object-cover", className)}
      />
    );
  const initials = person.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
  return (
    <span
      aria-hidden
      className={cn(
        "bg-muted text-muted-foreground flex items-center justify-center rounded-full text-sm font-medium",
        className,
      )}
    >
      {initials}
    </span>
  );
}

function Profile({ person }: { person: TeamPerson }) {
  return (
    <div className="grid gap-6 p-6">
      <div className="flex items-center gap-4 pe-6">
        <Photo person={person} className="size-20 shrink-0" />
        <div className="grid min-w-0 gap-1">
          <SheetTitle className="text-xl">{person.name}</SheetTitle>
          <SheetDescription>{person.role}</SheetDescription>
          <LinkedIn person={person} />
        </div>
      </div>
      <ProfileDetails person={person} />
    </div>
  );
}

/** A one-person team file: the same profile, as a page of its own. */
function ProfilePage({ person }: { person: TeamPerson }) {
  return (
    <article className="mx-auto grid w-full max-w-2xl gap-8 py-4">
      <header className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-start">
        <Photo person={person} className="size-28 shrink-0" />
        <div className="grid min-w-0 gap-1">
          <h2 className="text-3xl font-semibold tracking-tight">
            {person.name}
          </h2>
          <p className="text-muted-foreground text-base">{person.role}</p>
          <LinkedIn person={person} />
        </div>
      </header>
      <ProfileDetails person={person} />
    </article>
  );
}

function LinkedIn({ person }: { person: TeamPerson }) {
  const t = useTranslations("Components.TeamView");
  if (!person.linkedin) return null;
  return (
    <a
      href={person.linkedin}
      target="_blank"
      rel="noopener noreferrer"
      className="text-muted-foreground hover:text-foreground truncate text-xs underline-offset-2 hover:underline"
    >
      {t("linkedin")}
    </a>
  );
}

function ProfileDetails({ person }: { person: TeamPerson }) {
  const t = useTranslations("Components.TeamView");
  return (
    <>
      {person.summary ? (
        <p className="text-sm leading-relaxed">{person.summary}</p>
      ) : null}

      {person.highlights.length > 0 ? (
        <section className="grid gap-2">
          <SectionTitle>{t("highlights")}</SectionTitle>
          <ul className="grid gap-2">
            {person.highlights.map((highlight) => (
              <li key={highlight} className="flex gap-3 text-sm font-medium">
                <span
                  aria-hidden
                  className="bg-primary mt-1.5 size-1.5 shrink-0 rounded-full"
                />
                {highlight}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Entries title={t("experience")} entries={person.experience} />
      <Entries title={t("education")} entries={person.education} />
    </>
  );
}

function Entries({
  title,
  entries,
}: {
  title: string;
  entries: TeamPerson["experience"];
}) {
  if (entries.length === 0) return null;
  return (
    <section className="grid gap-2">
      <SectionTitle>{title}</SectionTitle>
      <ul className="divide-border divide-y border-y">
        {entries.map((entry) => (
          <li
            key={`${entry.title}-${entry.place}-${entry.when}`}
            className="flex justify-between gap-4 py-2"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{entry.title}</p>
              {entry.place ? (
                <p className="text-muted-foreground text-xs">{entry.place}</p>
              ) : null}
            </div>
            {entry.when ? (
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {entry.when}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <h3 className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
      {children}
    </h3>
  );
}

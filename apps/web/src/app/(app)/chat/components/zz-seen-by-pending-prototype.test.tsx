/**
 * PROTOTYPE — throwaway. Question: what should the "not yet" part of the
 * read-by popover look like once someone asks for the names?
 */
import { writeFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { it, vi } from "vitest";

import {
  ParticipantAvatar,
  participantName,
} from "@/components/chat/read-receipt-faces";
import type { ChatRoomUserParticipant } from "@/lib/clients/generated/core";
import { createTestFormatter } from "@/test/intl-formatter";

const formatter = createTestFormatter({ timeZone: "UTC", hourCycle: "h12" });

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    key === "pendingCount"
      ? `${values?.count} not yet`
      : key === "readersTitle"
        ? "Read by"
        : `Seen by ${values?.count} people`,
  useFormatter: () => formatter,
}));

import { RoomSeenByLine } from "./room-seen-by-line";

const p = (id: string, name: string): ChatRoomUserParticipant => ({
  id,
  name,
  email: `${id}@x.io`,
  image: null,
  presence: "offline",
  access: "member",
  lastReadAt: null,
});
const READERS = [
  {
    participant: p("f", "Faizan Shaikh"),
    lastReadAt: new Date("2026-09-24T21:56:00Z"),
  },
  {
    participant: p("s", "Shreya Chowdhury"),
    lastReadAt: new Date("2026-09-24T21:55:00Z"),
  },
  {
    participant: p("l", "Francis Luz"),
    lastReadAt: new Date("2026-09-24T21:52:00Z"),
  },
];
const PENDING = [
  p("g", "Shivangi Gupta"),
  p("a", "Sandro"),
  p("k", "Alexa Kuk"),
];
const POPOVER =
  "bg-popover text-popover-foreground w-56 rounded-md border p-1 shadow-md";
const ROW = "flex h-7 items-center gap-2 px-2";

function Readers() {
  return (
    <>
      <h3 className="text-muted-foreground px-2 pt-1 pb-0.5 text-xs font-medium">
        Read by
      </h3>
      <ul>
        {READERS.map(({ participant, lastReadAt }) => (
          <li key={participant.id} className={ROW}>
            <ParticipantAvatar
              participant={participant}
              className="size-5"
              textClassName="text-[0.5rem]"
            />
            <span className="min-w-0 flex-1 truncate text-xs">
              {participantName(participant)}
            </span>
            <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
              {formatter.dateTime(lastReadAt, "time")}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function GreyFaces({ size = "size-4" }: { size?: string }) {
  return (
    <span className="flex -space-x-1">
      {PENDING.map((person) => (
        <ParticipantAvatar
          key={person.id}
          participant={person}
          className={`${size} opacity-60 grayscale`}
          textClassName="text-[0.4375rem]"
        />
      ))}
    </span>
  );
}

/** 1 — the summary row gives way to rows shaped like the reader rows. */
function ReplaceWithRows() {
  return (
    <div className={POPOVER}>
      <Readers />
      <ul className="mt-0.5 border-t pt-0.5">
        {PENDING.map((person) => (
          <li key={person.id} className={ROW}>
            <ParticipantAvatar
              participant={person}
              className="size-5 opacity-60 grayscale"
              textClassName="text-[0.5rem]"
            />
            <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
              {participantName(person)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 2 — one wrapped caption line, always there, nothing to click. */
function CaptionLine() {
  return (
    <div className={POPOVER}>
      <Readers />
      <p className="text-muted-foreground mt-0.5 border-t px-2 pt-1.5 pb-1 text-xs leading-4">
        <span className="font-medium">Not yet:</span>{" "}
        {PENDING.map(participantName).join(", ")}
      </p>
    </div>
  );
}

/** 3 — the row stays one row; hovering it shows the names in a tooltip. */
function HoverTooltip() {
  return (
    <div className="relative">
      <div className={POPOVER}>
        <Readers />
        <div className="mt-0.5 border-t pt-0.5">
          <div className={`${ROW} bg-accent rounded-sm`}>
            <GreyFaces />
            <span className="text-muted-foreground flex-1 text-xs">
              3 not yet
            </span>
          </div>
        </div>
      </div>
      <div className="bg-primary-solid text-primary-solid-foreground absolute top-full left-2 mt-1 w-max max-w-52 rounded-md px-3 py-1.5 text-xs">
        Shivangi Gupta, Sandro, Alexa Kuk
      </div>
    </div>
  );
}

/** 4 — expanded is a strip of grey faces; the name shows on hover. */
function FacesStrip() {
  return (
    <div className="relative">
      <div className={POPOVER}>
        <Readers />
        <div className="mt-0.5 flex items-center gap-2 border-t px-2 pt-1.5 pb-1">
          <span className="text-muted-foreground text-xs">Not yet</span>
          <span className="flex gap-1">
            {PENDING.map((person, i) => (
              <span key={person.id} className="relative">
                <ParticipantAvatar
                  participant={person}
                  className={`size-5 grayscale ${i === 1 ? "ring-ring opacity-100 ring-2" : "opacity-60"}`}
                  textClassName="text-[0.5rem]"
                />
                {i === 1 ? (
                  <span className="bg-primary-solid text-primary-solid-foreground absolute top-full left-1/2 mt-2 w-max -translate-x-1/2 rounded-md px-2 py-1 text-xs">
                    Sandro
                  </span>
                ) : null}
              </span>
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}

function Cell({
  label,
  note,
  children,
}: {
  label: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <header>
        <h2 className="text-sm font-semibold">{label}</h2>
        <p className="text-muted-foreground max-w-72 text-xs">{note}</p>
      </header>
      <div>{children}</div>
    </section>
  );
}

function Page() {
  return (
    <main className="mx-auto grid max-w-6xl grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-x-8 gap-y-14 p-6">
      <Cell
        label="Now · Expand below"
        note="Faces stay in the summary row, bare indented names appear under it."
      >
        <div id="current-slot" />
      </Cell>
      <Cell
        label="1 · Replace with rows"
        note="Click '3 not yet': the row turns into grey rows shaped like the reader rows. Shown after the click."
      >
        <ReplaceWithRows />
      </Cell>
      <Cell
        label="2 · Caption line"
        note="Always shown, no click. Folds back to '12 not yet' plus expand only in big rooms."
      >
        <CaptionLine />
      </Cell>
      <Cell
        label="3 · Hover tooltip"
        note="The popover never grows. Hover (or tap) the row for the names. Shown while hovered."
      >
        <HoverTooltip />
      </Cell>
      <Cell
        label="4 · Faces strip"
        note="Grey faces in a row, name on hover. Shown with Sandro hovered."
      >
        <FacesStrip />
      </Cell>
    </main>
  );
}

it("dumps the pending-state prototype", async () => {
  const user = userEvent.setup();
  const { container } = render(
    <>
      <Page />
      <RoomSeenByLine
        readers={READERS}
        receipts={{ readers: READERS, nonReaders: PENDING }}
      />
    </>,
  );
  await user.click(screen.getByTestId("room-seen-by-line"));
  await user.click(await screen.findByTestId("room-seen-by-pending-toggle"));
  const detail = await screen.findByTestId("room-seen-by-detail");
  const copy = detail.cloneNode(true) as HTMLElement;
  copy.removeAttribute("style");
  document.getElementById("current-slot")?.appendChild(copy);
  writeFileSync(
    process.env.SEEN_BY_OUT ?? "/tmp/x.html",
    container.querySelector("main")?.outerHTML ?? "",
  );
});

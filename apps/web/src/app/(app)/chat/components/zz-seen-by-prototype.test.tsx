/**
 * PROTOTYPE — throwaway. Question: how small can the "Read by" popover get
 * before it stops answering "who has seen my message"?
 *
 * Renders the real current popover beside three alternatives and dumps one
 * static HTML page (see zz-seen-by-prototype-css.mjs for the CSS half).
 */
import { writeFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { it, vi } from "vitest";

import type { RoomReader } from "@/app/chat/hooks/use-room-read-receipts";
import {
  ParticipantAvatar,
  participantName,
  ReadReceiptFaces,
} from "@/components/chat/read-receipt-faces";
import type { ChatRoomUserParticipant } from "@/lib/clients/generated/core";
import { createTestFormatter } from "@/test/intl-formatter";

const formatter = createTestFormatter({ timeZone: "UTC", hourCycle: "h12" });
const COPY: Record<string, string> = {
  readersTitle: "Read by",
  notRead: "Not read yet",
};

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    key === "summary" ? `Seen by ${values?.count} people` : (COPY[key] ?? key),
  useFormatter: () => formatter,
}));

import { RoomSeenByLine } from "./room-seen-by-line";

const OUT = process.env.SEEN_BY_OUT ?? "/tmp/seen-by-body.html";

function person(id: string, name: string): ChatRoomUserParticipant {
  return {
    id,
    name,
    email: `${id}@example.com`,
    image: null,
    presence: "offline",
    access: "member",
    lastReadAt: null,
  };
}

const READERS: RoomReader[] = [
  {
    participant: person("faizan", "Faizan Shaikh"),
    lastReadAt: new Date("2026-09-24T21:56:00Z"),
  },
  {
    participant: person("shreya", "Shreya Chowdhury"),
    lastReadAt: new Date("2026-09-24T21:55:00Z"),
  },
  {
    participant: person("francis", "Francis Luz"),
    lastReadAt: new Date("2026-09-24T21:52:00Z"),
  },
];
const PENDING = [
  person("shivangi", "Shivangi Gupta"),
  person("sandro", "Sandro"),
  person("alexa", "Alexa Kuk"),
];
const TOTAL = READERS.length + PENDING.length;
const time = (d: Date) => formatter.dateTime(d, "time");
const POPOVER =
  "bg-popover text-popover-foreground rounded-md border shadow-md";

/** A last message in the transcript, with the faces in its corner. */
function MessageFrame({
  label,
  note,
  surface,
  below,
}: {
  label: string;
  note: string;
  surface?: ReactNode;
  below?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <header>
        <h2 className="text-sm font-semibold">{label}</h2>
        <p className="text-muted-foreground text-xs">{note}</p>
      </header>
      <div className="bg-background relative flex min-h-[22rem] flex-col justify-end rounded-lg border p-4">
        <div className="text-muted-foreground mb-4 text-sm">
          <span className="text-foreground font-semibold">Patrick Tobler</span>{" "}
          <span className="text-xs">8:52 PM</span>
          <p className="prose prose-sm dark:prose-invert">
            almost made it through the week
          </p>
        </div>
        <div className="relative flex gap-3 pb-6">
          <span className="bg-muted size-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold">Andreas Osberghaus</span>
              <span className="text-muted-foreground text-xs">9:52 PM</span>
            </div>
            <div className="prose prose-sm dark:prose-invert">
              <p>
                @Francis Luz I like how Linear have done it, but then we also
                have to change the order of the task events.
              </p>
            </div>
            {below}
          </div>
          {surface}
        </div>
      </div>
    </section>
  );
}

/** Faces pinned bottom-right, with an open surface above them. */
function Corner({
  children,
  open,
}: {
  children?: ReactNode;
  open?: ReactNode;
}) {
  return (
    <div className="absolute end-0 bottom-0">
      {open ? (
        <div className="absolute end-0 bottom-full mb-1">{open}</div>
      ) : null}
      <span className="group flex" data-state="open">
        {children ?? (
          <ReadReceiptFaces readers={READERS} size="sm" tone="quiet" />
        )}
      </span>
    </div>
  );
}

/** B — caption scale, one header with the fraction, the unread folded. */
function CompactList() {
  return (
    <div className={`${POPOVER} w-56 p-1`}>
      <h3 className="text-muted-foreground flex justify-between px-2 pt-1 pb-0.5 text-xs">
        <span className="text-foreground font-medium">
          Seen by {READERS.length}
        </span>
        <span className="tabular-nums">of {TOTAL}</span>
      </h3>
      <ul>
        {READERS.map(({ participant, lastReadAt }) => (
          <li key={participant.id} className="flex h-7 items-center gap-2 px-2">
            <ParticipantAvatar
              participant={participant}
              className="size-5"
              textClassName="text-[0.5rem]"
            />
            <span className="min-w-0 flex-1 truncate text-xs">
              {participantName(participant)}
            </span>
            <span className="text-muted-foreground shrink-0 text-[0.6875rem] tabular-nums">
              {time(lastReadAt)}
            </span>
          </li>
        ))}
      </ul>
      <details className="group/pending mt-0.5 border-t pt-0.5">
        <summary className="hover:bg-accent flex h-7 cursor-pointer list-none items-center gap-2 rounded-sm px-2 [&::-webkit-details-marker]:hidden">
          <span className="flex -space-x-1">
            {PENDING.map((p) => (
              <ParticipantAvatar
                key={p.id}
                participant={p}
                className="size-4 opacity-60 grayscale"
                textClassName="text-[0.4375rem]"
              />
            ))}
          </span>
          <span className="text-muted-foreground flex-1 text-xs">
            {PENDING.length} not yet
          </span>
          <span className="text-muted-foreground text-xs group-open/pending:rotate-180">
            ⌄
          </span>
        </summary>
        <ul>
          {PENDING.map((p) => (
            <li
              key={p.id}
              className="text-muted-foreground flex h-6 items-center px-2 ps-8 text-xs"
            >
              {participantName(p)}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/** C — a tooltip on hover: two lines of prose, no list, no avatars. */
function TooltipSummary() {
  const names = READERS.map(
    (r) => participantName(r.participant).split(" ")[0],
  );
  return (
    <div className="bg-primary-solid text-primary-solid-foreground w-max max-w-56 rounded-md px-3 py-1.5 text-xs">
      <p>
        Seen by {names.slice(0, -1).join(", ")} and {names.at(-1)}
      </p>
      <p className="opacity-70">
        Latest {time(READERS[0].lastReadAt)} · {PENDING.length} not yet
      </p>
    </div>
  );
}

/** D — no floating surface: the faces unfold a caption line in place. */
function InlineCaption() {
  return (
    <details open className="group/seen mt-1">
      <summary className="flex cursor-pointer list-none justify-end [&::-webkit-details-marker]:hidden">
        <span className="group flex" data-state="closed">
          <ReadReceiptFaces readers={READERS} size="sm" tone="quiet" />
        </span>
      </summary>
      <p className="text-muted-foreground mt-1 text-end text-[0.6875rem] leading-4">
        {READERS.map(({ participant, lastReadAt }, i) => (
          <span key={participant.id}>
            {i > 0 ? " · " : ""}
            <span className="text-foreground/80">
              {participantName(participant)}
            </span>{" "}
            <span className="tabular-nums">{time(lastReadAt)}</span>
          </span>
        ))}
        <br />
        Not yet: {PENDING.map(participantName).join(", ")}
      </p>
    </details>
  );
}

function Page() {
  return (
    <main className="mx-auto grid max-w-6xl gap-8 p-6 lg:grid-cols-2">
      <MessageFrame
        label="A · Current"
        note="Click. 240px wide, 24px avatars, names at 14px (same as the message body), two headings and a divider."
        surface={
          <div className="absolute end-0 bottom-0">
            <div
              id="current-slot"
              className="absolute end-0 bottom-full mb-1"
            />
            <div id="current-trigger">
              <RoomSeenByLine
                readers={READERS}
                receipts={{
                  readers: READERS,
                  nonReaders: PENDING,
                }}
              />
            </div>
          </div>
        }
      />
      <MessageFrame
        label="B · Compact list"
        note="Click. 224px, 20px avatars, 12px names, one header with the fraction. The unread fold into one row: click it."
        surface={<Corner open={<CompactList />} />}
      />
      <MessageFrame
        label="C · Hover tooltip"
        note="Hover, no click. Two lines of prose in the app's tooltip style. Times and full list move to the Members panel."
        surface={<Corner open={<TooltipSummary />} />}
      />
      <MessageFrame
        label="D · Inline caption"
        note="Click the faces (they sit under the text here): a caption line unfolds under the message. No floating surface at all."
        below={<InlineCaption />}
      />
    </main>
  );
}

it("dumps the seen-by prototype", async () => {
  const { container } = render(<Page />);
  await userEvent.click(screen.getByTestId("room-seen-by-line"));
  const detail = document.querySelector<HTMLElement>(
    '[data-testid="room-seen-by-detail"]',
  );
  if (!detail) throw new Error("current popover did not open");
  detail.removeAttribute("style");
  document.getElementById("current-slot")?.appendChild(detail);
  writeFileSync(OUT, container.innerHTML, "utf8");
});

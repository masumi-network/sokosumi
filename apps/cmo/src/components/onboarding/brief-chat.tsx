"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { Loader2 } from "lucide-react";
import { type ReactNode, type RefObject, useState } from "react";

import { AGENT_NAME } from "../../lib/agent";
import { type BrandSectionKey } from "../../lib/brand-sections";
import { channelLabel, type SocialProvider } from "../../lib/calendar";
import type { CusoMessage } from "../../lib/chat-messages";
import { joinNames } from "../../lib/names";
import { businessDisplayName } from "../business-mark";
import { money, PACES } from "../strategy-core";
import { SubmitButton } from "../submit-button";
import type { Answer } from "./actions";
import {
  type Ask,
  adEntries,
  type BriefDone,
  pieceCount,
  weekOne,
} from "./brief";
import { Refusal } from "./refusal";

type Strategy = NonNullable<CmoOverview["strategy"]>;

/** What the chat can do; the flow binds each to Core. */
export interface ChatHandlers {
  answerBrand: (id: string, answer: Answer, note?: string) => Promise<void>;
  confirmBrand: () => Promise<string | null>;
  /** Without a section, a general correction of the Brand Brain. */
  fixBrand: (
    section: BrandSectionKey | null,
    note: string,
  ) => Promise<string | null>;
  retryResearch: () => Promise<string | null>;
  reply: (text: string) => Promise<void>;
  retryPlan: () => Promise<string | null>;
  /** A change to the plan in words: always a patch. */
  patch: (note: string, label: string) => Promise<string | null>;
  brief: (step: BriefDone) => void;
  answerPlan: (id: string, answer: Answer, note?: string) => Promise<void>;
  applyPlan: () => Promise<string | null>;
  setAds: (monthly: number, currency: string) => Promise<string | null>;
  approve: () => Promise<string | null>;
  connect: (key: SocialProvider) => void;
  launch: () => void;
}

export interface ConnectState {
  /** The plan's networks Cuso posts to, with how many pieces each. */
  networks: { key: SocialProvider; pieces: number; connected: boolean }[];
  pending: string | null;
  error: string | null;
}

interface ChatAskProps {
  ask: Ask;
  overview: CmoOverview;
  messages: CusoMessage[];
  handlers: ChatHandlers;
  connect: ConnectState;
  /** The free text field: a piece tapped on the page writes into it. */
  draft: string;
  setDraft: (text: string) => void;
  draftRef: RefObject<HTMLInputElement | null>;
}

const FAILED = "That didn't go through. Try again in a moment.";

/** One call at a time from the chat, with its refusal. */
function useRun() {
  const [pending, setPending] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const run = async (
    which: string,
    call: () => Promise<string | null | undefined | void>,
  ) => {
    setPending(which);
    setRefusal(null);
    try {
      setRefusal((await call()) ?? null);
    } catch {
      setRefusal(FAILED);
    } finally {
      setPending(null);
    }
  };
  return { pending, refusal, run };
}

interface BubbleProps {
  question: string;
  sub?: string | undefined;
  /** An earlier question, kept above the reply: focus skips it. */
  past?: boolean;
  children?: ReactNode;
}

/** Cuso's question: the focus lands here when the chat opens. */
function Bubble({ question, sub, past = false, children }: BubbleProps) {
  return (
    <div className={past ? "brief-bubble past" : "brief-bubble"}>
      <h2
        className="brief-question"
        tabIndex={past ? undefined : -1}
        data-brief-question={past ? undefined : true}
      >
        {question}
      </h2>
      {sub ? <p className="brief-sub">{sub}</p> : null}
      {children}
    </div>
  );
}

/** What the person said, as their side of the chat. */
function Said({ children }: { children: ReactNode }) {
  return <p className="brief-said">{children}</p>;
}

interface AnswersProps {
  children: ReactNode;
}

function Answers({ children }: AnswersProps) {
  return (
    <div className="brief-answers" role="group" aria-label="Your answer">
      {children}
    </div>
  );
}

interface ChoiceProps {
  label: string;
  primary?: boolean;
  busy?: boolean;
  disabled?: boolean;
  pressed?: boolean;
  onClick: () => void;
}

/** One answer: a real button; the main one is Iris. */
function Choice({
  label,
  primary,
  busy,
  disabled,
  pressed,
  onClick,
}: ChoiceProps) {
  return (
    <button
      type="button"
      className={
        primary ? "button button-small brief-primary" : "button button-small"
      }
      disabled={disabled || busy}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {busy ? <Loader2 size={14} className="spin" aria-hidden="true" /> : null}
      {label}
    </button>
  );
}

interface NoteProps {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (text: string) => void;
  onSend: (text: string) => Promise<void>;
  inputRef?: RefObject<HTMLInputElement | null>;
  disabled?: boolean;
  /** A currency in front, for a number. */
  prefix?: string;
  inputMode?: "text" | "decimal";
}

/**
 * The one field: always the last row, its placeholder saying what typing
 * does. Send is off until there is text; Enter sends.
 */
function Note({
  id,
  label,
  placeholder,
  value,
  onChange,
  onSend,
  inputRef,
  disabled,
  prefix,
  inputMode = "text",
}: NoteProps) {
  return (
    <form
      className="brief-note"
      action={async () => {
        const text = value.trim();
        if (!text) return;
        await onSend(text);
      }}
    >
      <label className="ob-sr" htmlFor={id}>
        {label}
      </label>
      <span className={prefix ? "brief-field has-prefix" : "brief-field"}>
        {prefix ? (
          <span className="brief-prefix" aria-hidden="true">
            {prefix}
          </span>
        ) : null}
        <input
          id={id}
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          inputMode={inputMode}
          maxLength={400}
          disabled={disabled}
        />
      </span>
      <SubmitButton
        className="button button-secondary button-small"
        disabled={disabled || !value.trim()}
      >
        Send
      </SubmitButton>
    </form>
  );
}

/** The question in the chat for one ask. */
export function ChatAsk(props: ChatAskProps) {
  switch (props.ask.kind) {
    case "research-reply":
      return <ResearchReply {...props} />;
    case "research-retry":
      return <ResearchRetry {...props} />;
    case "brand-question":
      return <BrandQuestion {...props} id={props.ask.id} />;
    case "brand-check":
      return <BrandCheck {...props} />;
    case "plan-retry":
      return <PlanRetry {...props} />;
    case "briefing-plan":
      return <BriefingPlan {...props} />;
    case "briefing-week":
      return <BriefingWeek {...props} />;
    case "plan-question":
      return <PlanQuestion {...props} id={props.ask.id} />;
    case "plan-apply":
      return <PlanApply {...props} />;
    case "briefing-ads":
      return <BriefingAds {...props} />;
    case "approve":
      return <Approve {...props} canApprove={props.ask.canApprove} />;
    case "connect":
      return <Connect {...props} />;
  }
}

function ResearchReply({ messages, handlers }: ChatAskProps) {
  const asked = [...messages].reverse().find((message) => message.fromCuso);
  const [text, setText] = useState("");
  return (
    <Bubble question={asked?.content ?? `${AGENT_NAME} has a question.`}>
      <Note
        id="brief-reply"
        label="Your answer"
        placeholder="Your answer"
        value={text}
        onChange={setText}
        onSend={async (reply) => {
          await handlers.reply(reply);
          setText("");
        }}
      />
    </Bubble>
  );
}

function ResearchRetry({ overview, handlers }: ChatAskProps) {
  const { pending, refusal, run } = useRun();
  const work = overview.work;
  const running = work?.status === "running";
  const saved = work?.kind === "research" ? work.sectionsSaved : 0;
  const question = running
    ? "This is taking much longer than usual. Try again?"
    : "I stopped reading. Try again?";
  const sub =
    saved > 0 ? `I keep the ${saved} sections I saved.` : "Nothing was lost.";
  return (
    <Bubble question={question} sub={sub}>
      <Answers>
        <Choice
          label="Try again"
          primary
          busy={pending === "retry"}
          onClick={() => run("retry", handlers.retryResearch)}
        />
      </Answers>
      {refusal ? (
        <Refusal text={refusal} topUpUrl={overview.subscribeUrl} />
      ) : null}
    </Bubble>
  );
}

interface QuestionProps extends ChatAskProps {
  id: string;
}

/** Yes, No or Not sure, and what is true instead; a typed note is a No. */
function YesNo({
  question,
  sub,
  placeholder,
  onAnswer,
  noteId,
}: {
  question: string;
  sub?: string | undefined;
  placeholder: string;
  onAnswer: (answer: Answer, note?: string) => Promise<void>;
  noteId: string;
}) {
  const { pending, refusal, run } = useRun();
  const [note, setNote] = useState("");
  const answer = (value: Answer) =>
    run(value, async () => {
      await onAnswer(
        value,
        value === "no" ? note.trim() || undefined : undefined,
      );
    });
  return (
    <Bubble question={question} sub={sub}>
      <Answers>
        <Choice
          label="Yes"
          primary
          busy={pending === "yes"}
          disabled={pending !== null}
          onClick={() => answer("yes")}
        />
        <Choice
          label="No"
          busy={pending === "no"}
          disabled={pending !== null}
          onClick={() => answer("no")}
        />
        <Choice
          label="Not sure"
          busy={pending === "unsure"}
          disabled={pending !== null}
          onClick={() => answer("unsure")}
        />
      </Answers>
      <Note
        id={noteId}
        label={placeholder}
        placeholder={placeholder}
        value={note}
        onChange={setNote}
        disabled={pending !== null}
        onSend={(text) =>
          run("no", async () => {
            await onAnswer("no", text);
          })
        }
      />
      {refusal ? (
        <p className="alert" role="alert">
          {refusal}
        </p>
      ) : null}
    </Bubble>
  );
}

function BrandQuestion({ overview, handlers, id }: QuestionProps) {
  const question = overview.brandBrain?.questions?.find(
    (candidate) => candidate.id === id,
  );
  if (!question) return null;
  return (
    <YesNo
      // A new question starts with an empty note.
      key={id}
      question={question.question}
      placeholder="Or say what's true"
      noteId="brief-brand-note"
      onAnswer={(answer, note) => handlers.answerBrand(id, answer, note)}
    />
  );
}

/**
 * Looks like us, or a fix in words: a reply, not a form. Core takes the
 * note as a general correction and Cuso rewrites every section it changes.
 * Another fix is typing again.
 */
function BrandCheck({ overview, handlers }: ChatAskProps) {
  const { pending, refusal, run } = useRun();
  const [note, setNote] = useState("");
  const [sent, setSent] = useState<string[]>([]);
  const name = businessDisplayName(overview);
  const last = sent.at(-1);
  return (
    <>
      {last ? (
        <>
          <Bubble question={`Did I get ${name} right?`} past />
          <Said>{last}</Said>
        </>
      ) : null}
      <Bubble
        question={
          last ? "Fixing it now. Anything else?" : `Did I get ${name} right?`
        }
      >
        <Answers>
          <Choice
            label={last ? "That's all" : "Looks like us"}
            primary
            busy={pending === "confirm"}
            disabled={pending !== null}
            onClick={() => run("confirm", handlers.confirmBrand)}
          />
        </Answers>
        <Note
          id="brief-fix-note"
          label="What to change"
          placeholder="Or say what to change"
          value={note}
          onChange={setNote}
          disabled={pending !== null}
          onSend={(text) =>
            run("fix", async () => {
              const refused = await handlers.fixBrand(null, text);
              if (refused) return refused;
              setSent((current) => [...current, text]);
              setNote("");
              return null;
            })
          }
        />
        {refusal ? (
          <Refusal text={refusal} topUpUrl={overview.subscribeUrl} />
        ) : null}
      </Bubble>
    </>
  );
}

function PlanRetry({ overview, handlers }: ChatAskProps) {
  const { pending, refusal, run } = useRun();
  const work = overview.work;
  const stopped = work?.kind === "strategy";
  const running = stopped && work.status === "running";
  return (
    <Bubble
      question={
        running
          ? "Your plan is taking much longer than usual. Try again?"
          : stopped
            ? "I stopped before I finished your plan. Try again?"
            : "Ready for your plan?"
      }
      sub={stopped ? "Nothing was lost." : undefined}
    >
      <Answers>
        <Choice
          label={stopped ? "Try again" : "Write my plan"}
          primary
          busy={pending === "retry"}
          onClick={() => run("retry", handlers.retryPlan)}
        />
      </Answers>
      {refusal ? (
        <Refusal text={refusal} topUpUrl={overview.subscribeUrl} />
      ) : null}
    </Bubble>
  );
}

/** A change in words, as a patch; shared by the briefing steps. */
function PlanNote({
  placeholder,
  draft,
  setDraft,
  draftRef,
  handlers,
  onRefused,
}: Pick<ChatAskProps, "draft" | "setDraft" | "draftRef" | "handlers"> & {
  placeholder: string;
  onRefused: (refusal: string | null) => void;
}) {
  return (
    <Note
      id="brief-plan-note"
      label="What to change"
      placeholder={placeholder}
      value={draft}
      onChange={setDraft}
      inputRef={draftRef}
      onSend={async (text) => {
        try {
          const refused = await handlers.patch(
            text,
            `Changing your plan: “${text}”`,
          );
          onRefused(refused);
          if (!refused) setDraft("");
        } catch {
          onRefused(FAILED);
        }
      }}
    />
  );
}

function BriefingPlan(props: ChatAskProps) {
  const { handlers, overview } = props;
  const [refusal, setRefusal] = useState<string | null>(null);
  return (
    <Bubble question="Does this plan sound right?">
      <Answers>
        <Choice
          label="Sounds right"
          primary
          onClick={() => handlers.brief("plan")}
        />
      </Answers>
      <PlanNote
        {...props}
        placeholder="Or say what to change"
        onRefused={setRefusal}
      />
      {refusal ? (
        <Refusal text={refusal} topUpUrl={overview.subscribeUrl} />
      ) : null}
    </Bubble>
  );
}

/** Fewer or More moves the pace one step, as the pace picker words it. */
function paceNote(strategy: Strategy, step: -1 | 1): string | null {
  const at = PACES.findIndex((pace) => pace.level === strategy.pace?.level);
  const next = PACES[at + step];
  if (at === -1) {
    return step < 0
      ? "Fewer pieces a week: drop the weakest calendar entries."
      : "More pieces a week: add calendar entries where they help most.";
  }
  if (!next) return null;
  return `Change the pace to ${next.name} (${next.does.toLowerCase()}): add or drop only the calendar entries the new pace needs.`;
}

/**
 * Posts a week, from week one in full. Fewer or More shows only when the
 * plan can move that way: a button that can't be pressed is no answer.
 */
function BriefingWeek(props: ChatAskProps) {
  const { overview, handlers } = props;
  const strategy = overview.strategy as Strategy;
  const week = weekOne(strategy.calendar);
  const { pending, refusal, run } = useRun();
  const [noteRefusal, setNoteRefusal] = useState<string | null>(null);
  const fewer = paceNote(strategy, -1);
  const more = paceNote(strategy, 1);
  return (
    <Bubble
      question={`About ${week.length} ${week.length === 1 ? "post" : "posts"} a week. Keep that?`}
    >
      <Answers>
        <Choice
          label={`Keep ${week.length}`}
          primary
          disabled={pending !== null}
          onClick={() => handlers.brief("pace")}
        />
        {fewer ? (
          <Choice
            label="Fewer"
            busy={pending === "fewer"}
            disabled={pending !== null}
            onClick={() =>
              run("fewer", () => handlers.patch(fewer, "Fewer posts a week"))
            }
          />
        ) : null}
        {more ? (
          <Choice
            label="More"
            busy={pending === "more"}
            disabled={pending !== null}
            onClick={() =>
              run("more", () => handlers.patch(more, "More posts a week"))
            }
          />
        ) : null}
      </Answers>
      <PlanNote
        {...props}
        placeholder="Or say what to change"
        onRefused={setNoteRefusal}
      />
      {refusal || noteRefusal ? (
        <Refusal
          text={(refusal ?? noteRefusal) as string}
          topUpUrl={overview.subscribeUrl}
        />
      ) : null}
    </Bubble>
  );
}

function PlanQuestion({ overview, handlers, id }: QuestionProps) {
  const question = overview.strategy?.questions?.find(
    (candidate) => candidate.id === id,
  );
  if (!question) return null;
  return (
    <YesNo
      key={id}
      question={question.question}
      placeholder="Or say what instead"
      noteId="brief-plan-question-note"
      onAnswer={(answer, note) => handlers.answerPlan(id, answer, note)}
    />
  );
}

function PlanApply({ overview, handlers }: ChatAskProps) {
  const { pending, refusal, run } = useRun();
  return (
    <Bubble
      question="I'll change the plan for your answers."
      sub="Only the pieces your nos touch move."
    >
      <Answers>
        <Choice
          label="Change the plan"
          primary
          busy={pending === "apply"}
          onClick={() => run("apply", handlers.applyPlan)}
        />
      </Answers>
      {refusal ? (
        <Refusal text={refusal} topUpUrl={overview.subscribeUrl} />
      ) : null}
    </Bubble>
  );
}

const AD_NETWORK: Record<string, string> = {
  google_ads: "Google",
  meta_ads: "Meta",
};

/** "$" for USD: the currency in front of the amount field. */
function currencySign(currency: string): string {
  try {
    return (
      new Intl.NumberFormat("en", { style: "currency", currency })
        .formatToParts(0)
        .find((part) => part.type === "currency")?.value ?? currency
    );
  } catch {
    return currency;
  }
}

/**
 * A whole amount as people type it: "450", "$450", "1,500", "1.500" or
 * "1 500". Separators between groups of three are thousands; anything after
 * another separator is cents and is rounded. Null when it is not a number.
 */
export function parseAmount(text: string): number | null {
  const digits = text.replace(/[^\d.,]/g, "");
  if (!/\d/.test(digits)) return null;
  const whole = /^\d{1,3}([.,]\d{3})+$/.test(digits)
    ? digits.replace(/[.,]/g, "")
    : digits.replace(/[.,](?=\d{3}(\D|$))/g, "").replace(",", ".");
  const amount = Number(whole);
  return Number.isFinite(amount) ? Math.round(amount) : null;
}

/** Yes to the suggested budget, no ads, or another amount in the field. */
function BriefingAds({ overview, handlers }: ChatAskProps) {
  const strategy = overview.strategy as Strategy;
  const ads = strategy.ads;
  const entries = adEntries(strategy);
  const { pending, refusal, run } = useRun();
  const [amount, setAmount] = useState("");
  if (!ads) return null;
  const network = joinNames(
    [
      ...new Set(entries.map((entry) => AD_NETWORK[entry.channel] ?? "")),
    ].filter(Boolean),
  );
  const price = money(ads.monthly, ads.currency);
  return (
    <Bubble
      question={`Spend ${price} a month on ${network ? `${network} ads` : "ads"}?`}
      sub={`Paid to ${network || "the ad network"}, on top of your plan.`}
    >
      <Answers>
        <Choice
          label={`Yes, ${price}`}
          primary
          disabled={pending !== null}
          onClick={() => handlers.brief("ads")}
        />
        <Choice
          label="No ads"
          busy={pending === "none"}
          disabled={pending !== null}
          onClick={() => run("none", () => handlers.setAds(0, ads.currency))}
        />
      </Answers>
      <Note
        id="brief-ads-amount"
        label={`Another monthly ad budget, in ${ads.currency}`}
        placeholder="Or another amount"
        prefix={currencySign(ads.currency)}
        inputMode="decimal"
        value={amount}
        onChange={setAmount}
        disabled={pending !== null}
        onSend={(text) =>
          run("amount", () => {
            const monthly = parseAmount(text);
            return monthly === null
              ? Promise.resolve("Type an amount, such as 150.")
              : handlers.setAds(monthly, ads.currency);
          })
        }
      />
      {refusal ? (
        <Refusal text={refusal} topUpUrl={overview.subscribeUrl} />
      ) : null}
    </Bubble>
  );
}

function Approve(props: ChatAskProps & { canApprove: boolean }) {
  const { overview, handlers, canApprove } = props;
  const { pending, refusal, run } = useRun();
  const [noteRefusal, setNoteRefusal] = useState<string | null>(null);
  const pieces = pieceCount(overview.strategy?.calendar ?? []);
  if (!canApprove) {
    return (
      <Bubble
        question="Your month is ready for approval."
        sub="Only an owner or admin can approve."
      />
    );
  }
  return (
    <Bubble
      question="Ready to approve your month?"
      sub={`I start making all ${pieces} pieces. Nothing posts until you connect.`}
    >
      <Answers>
        <Choice
          label="Approve plan"
          primary
          busy={pending === "approve"}
          disabled={pending !== null}
          onClick={() => run("approve", handlers.approve)}
        />
      </Answers>
      <PlanNote
        {...props}
        placeholder="Or say what to change"
        onRefused={setNoteRefusal}
      />
      {refusal || noteRefusal ? (
        <Refusal
          text={(refusal ?? noteRefusal) as string}
          topUpUrl={overview.subscribeUrl}
        />
      ) : null}
    </Bubble>
  );
}

function Connect({ connect, handlers }: ChatAskProps) {
  const connected = connect.networks.filter((network) => network.connected);
  // At most three answers: the networks with the most pieces; the rest
  // connect later on Channels.
  const open = connect.networks
    .filter((network) => !network.connected)
    .sort((a, b) => b.pieces - a.pieces);
  const names = (list: typeof open) =>
    joinNames(list.map((network) => channelLabel(network.key)));
  const connectButtons = open
    .slice(0, connected.length === 0 ? 3 : 2)
    .map((network) => (
      <Choice
        key={network.key}
        label={`Connect ${channelLabel(network.key)}`}
        primary={connected.length === 0 && open.length === 1}
        busy={connect.pending === network.key}
        disabled={connect.pending !== null}
        onClick={() => handlers.connect(network.key)}
      />
    ));
  const error = connect.error ? (
    <p className="alert" role="alert">
      {/configured|unavailable|set up/i.test(connect.error)
        ? "Connecting accounts isn't available here yet."
        : connect.error}
    </p>
  ) : null;
  if (connected.length === 0) {
    return (
      <Bubble
        question={
          connect.networks.length > 0
            ? "Connect where week one posts."
            : "Your plan posts nowhere I can connect yet. Launch when you're ready."
        }
        sub={
          connect.networks.length > 0 ? "One is enough to launch." : undefined
        }
      >
        <Answers>
          {connectButtons}
          {connect.networks.length === 0 ? (
            <Choice label="Launch" primary onClick={handlers.launch} />
          ) : null}
        </Answers>
        {error}
      </Bubble>
    );
  }
  return (
    <>
      <Said>Connected {names(connected)}.</Said>
      <Bubble
        question={`${names(connected)} ${connected.length === 1 ? "is" : "are"} connected. Launch now?`}
        sub={
          open.length > 0
            ? `${names(open)} ${open.length === 1 ? "waits" : "wait"} as drafts.`
            : undefined
        }
      >
        <Answers>
          <Choice
            label="Launch"
            primary
            disabled={connect.pending !== null}
            onClick={handlers.launch}
          />
          {connectButtons}
        </Answers>
        {error}
      </Bubble>
    </>
  );
}

/** The welcome back: what waits, in one count. */
export function WelcomeBack({
  waiting,
  onStart,
}: {
  waiting: number;
  onStart: () => void;
}) {
  return (
    <Bubble question={`Welcome back. ${waiting} quick things need you.`}>
      <Answers>
        <Choice label="Start" primary onClick={onStart} />
      </Answers>
    </Bubble>
  );
}

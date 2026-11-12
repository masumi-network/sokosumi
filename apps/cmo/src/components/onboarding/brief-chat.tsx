"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { Loader2 } from "lucide-react";
import { type ReactNode, type RefObject, useState } from "react";

import { AGENT_NAME } from "../../lib/agent";
import {
  BRAND_SECTIONS,
  type BrandSectionKey,
  brandProfile,
} from "../../lib/brand-sections";
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
  adWeek,
  type BriefDone,
  briefSteps,
  weekOne,
} from "./brief";
import { Refusal } from "./refusal";

type Strategy = NonNullable<CmoOverview["strategy"]>;

/** What the chat can do; the flow binds each to Core. */
export interface ChatHandlers {
  answerBrand: (id: string, answer: Answer, note?: string) => Promise<void>;
  confirmBrand: () => Promise<string | null>;
  fixBrand: (section: BrandSectionKey, note: string) => Promise<string | null>;
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
}

/** Free text always works: a line and Send. */
function Note({
  id,
  label,
  placeholder,
  value,
  onChange,
  onSend,
  inputRef,
  disabled,
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
      <input
        id={id}
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        maxLength={400}
        disabled={disabled}
      />
      <SubmitButton className="button button-secondary button-small">
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
        placeholder="Answer in your own words"
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
    : "I stopped before I finished reading. Try again?";
  const sub =
    saved > 0
      ? `I keep the ${saved} sections I saved and read only the groups still missing.`
      : "Nothing was lost. I start the read again.";
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
      sub={`About ${BRAND_SECTIONS[question.section].title.toLowerCase()}, from your Brand Brain.`}
      placeholder="If no, what's true?"
      noteId="brief-brand-note"
      onAnswer={(answer, note) => handlers.answerBrand(id, answer, note)}
    />
  );
}

/** The sections a fix can go to, in the order the Brand Brain reads. */
function fixableSections(overview: CmoOverview): BrandSectionKey[] {
  const brain = overview.brandBrain;
  if (!brain) return [];
  const profile = brandProfile(brain);
  return (Object.keys(BRAND_SECTIONS) as BrandSectionKey[]).filter(
    (key) => profile[key],
  );
}

/**
 * Looks like us, or a fix in words. Core fixes one section at a time, so the
 * person picks which one the fix is about.
 */
function BrandCheck({ overview, handlers }: ChatAskProps) {
  const { pending, refusal, run } = useRun();
  const [fixing, setFixing] = useState(false);
  const [section, setSection] = useState<BrandSectionKey | null>(null);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState<
    { section: BrandSectionKey; note: string }[]
  >([]);
  const name = businessDisplayName(overview);
  const last = sent.at(-1);
  const confirm = (
    <Choice
      label={last ? "That's all, looks like us" : "Looks like us"}
      primary
      busy={pending === "confirm"}
      disabled={pending !== null}
      onClick={() => run("confirm", handlers.confirmBrand)}
    />
  );
  return (
    <>
      {last ? (
        <>
          <Bubble question={`Did I get ${name} right?`} past />
          <Said>Fix something: {last.note}</Said>
        </>
      ) : null}
      <Bubble
        question={
          last
            ? `Got it. I'm fixing ${BRAND_SECTIONS[last.section].title} now, and your plan picks it up. Anything else?`
            : `Did I get ${name} right?`
        }
        sub={
          last
            ? undefined
            : "Your plan is built on this. You can fix any part later too."
        }
      >
        <Answers>
          {confirm}
          <Choice
            label={last ? "One more fix" : "Fix something"}
            pressed={fixing}
            disabled={pending !== null}
            onClick={() => setFixing(!fixing)}
          />
        </Answers>
        {fixing ? (
          <div className="brief-fix">
            <p className="brief-sub" id="brief-fix-which">
              Which part?
            </p>
            <div
              className="brief-sections"
              role="group"
              aria-labelledby="brief-fix-which"
            >
              {fixableSections(overview).map((key) => (
                <Choice
                  key={key}
                  label={BRAND_SECTIONS[key].title}
                  pressed={section === key}
                  onClick={() => setSection(key)}
                />
              ))}
            </div>
            <Note
              id="brief-fix-note"
              label="What's true instead"
              placeholder={
                section
                  ? `What's true about ${BRAND_SECTIONS[section].title.toLowerCase()}?`
                  : "Pick a part, then say what's true"
              }
              value={note}
              onChange={setNote}
              disabled={section === null}
              onSend={(text) =>
                run("fix", async () => {
                  if (!section) return null;
                  const refused = await handlers.fixBrand(section, text);
                  if (refused) return refused;
                  setSent((current) => [...current, { section, note: text }]);
                  setFixing(false);
                  setSection(null);
                  setNote("");
                  return null;
                })
              }
            />
          </div>
        ) : null}
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
      sub={
        stopped
          ? "Nothing was lost. I write it again from your Brand Brain."
          : "I build it from your Brand Brain and your answers."
      }
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
      label="Change something"
      placeholder={placeholder}
      value={draft}
      onChange={setDraft}
      inputRef={draftRef}
      onSend={async (text) => {
        try {
          const refused = await handlers.patch(text, text);
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
  const { handlers, draftRef, overview } = props;
  const [refusal, setRefusal] = useState<string | null>(null);
  return (
    <Bubble
      question="Your briefing is ready. Does this plan sound right?"
      sub={`${stepsWord(overview)} short steps. Nothing starts until you approve.`}
    >
      <Answers>
        <Choice
          label="Sounds right"
          primary
          onClick={() => handlers.brief("plan")}
        />
        <Choice
          label="Change something"
          onClick={() => draftRef.current?.focus()}
        />
      </Answers>
      <PlanNote
        {...props}
        placeholder="Your own goal, or what to change"
        onRefused={setRefusal}
      />
      {refusal ? (
        <Refusal text={refusal} topUpUrl={overview.subscribeUrl} />
      ) : null}
    </Bubble>
  );
}

const WORDS = ["", "One", "Two", "Three", "Four"];

function stepsWord(overview: CmoOverview): string {
  const steps = briefSteps(overview).length;
  return WORDS[steps] ?? String(steps);
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

function BriefingWeek(props: ChatAskProps) {
  const { overview, handlers } = props;
  const strategy = overview.strategy as Strategy;
  const week = weekOne(strategy.calendar);
  const perDay = Math.max(1, Math.round(week.length / 7));
  const { pending, refusal, run } = useRun();
  const [noteRefusal, setNoteRefusal] = useState<string | null>(null);
  const fewer = paceNote(strategy, -1);
  const more = paceNote(strategy, 1);
  return (
    <Bubble
      question={`Week one has ${week.length} ${week.length === 1 ? "piece" : "pieces"}, about ${perDay} a day. Keep this pace?`}
      sub="Tap any piece above to change it."
    >
      <Answers>
        <Choice
          label={`Keep ${week.length}`}
          primary
          disabled={pending !== null}
          onClick={() => handlers.brief("pace")}
        />
        <Choice
          label="Fewer"
          busy={pending === "fewer"}
          disabled={!fewer || pending !== null}
          onClick={() =>
            fewer && run("fewer", () => handlers.patch(fewer, "Fewer pieces"))
          }
        />
        <Choice
          label="More"
          busy={pending === "more"}
          disabled={!more || pending !== null}
          onClick={() =>
            more && run("more", () => handlers.patch(more, "More pieces"))
          }
        />
      </Answers>
      <PlanNote
        {...props}
        placeholder="Or change something, e.g. “No hype on Thursday”"
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
      placeholder="If no, what should I do instead?"
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
      sub="All your nos go in as one change. Only the pieces they touch move."
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

function BriefingAds(props: ChatAskProps) {
  const { overview, handlers } = props;
  const strategy = overview.strategy as Strategy;
  const ads = strategy.ads;
  const entries = adEntries(strategy);
  const { pending, refusal, run } = useRun();
  const [changing, setChanging] = useState(false);
  const [amount, setAmount] = useState(String(ads?.monthly ?? ""));
  const [noteRefusal, setNoteRefusal] = useState<string | null>(null);
  if (!ads) return null;
  const network = joinNames(
    [
      ...new Set(entries.map((entry) => AD_NETWORK[entry.channel] ?? "")),
    ].filter(Boolean),
  );
  const firstWeek = adWeek(strategy, entries[0]?.date);
  const price = money(ads.monthly, ads.currency);
  return (
    <Bubble
      question={`The plan has ${entries.length} search ${entries.length === 1 ? "ad" : "ads"}${firstWeek ? ` from week ${firstWeek}` : ""}. Spend ${price} a month on ${network || "ads"}?`}
      sub={`Paid to ${network || "the ad network"}, on top of your plan. Without ads I post only.`}
    >
      <Answers>
        <Choice
          label={`Yes, ${price}`}
          primary
          disabled={pending !== null}
          onClick={() => handlers.brief("ads")}
        />
        <Choice
          label="Change amount"
          pressed={changing}
          disabled={pending !== null}
          onClick={() => setChanging(!changing)}
        />
        <Choice
          label="No ads"
          busy={pending === "none"}
          disabled={pending !== null}
          onClick={() => run("none", () => handlers.setAds(0, ads.currency))}
        />
      </Answers>
      {changing ? (
        <form
          className="brief-note"
          action={() =>
            run("amount", () => {
              const monthly = Number(amount);
              if (!Number.isFinite(monthly) || monthly < 0) {
                return Promise.resolve("Type an amount, such as 150.");
              }
              return handlers.setAds(Math.round(monthly), ads.currency);
            })
          }
        >
          <label className="ob-sr" htmlFor="brief-ads-amount">
            Monthly ad budget in {ads.currency}
          </label>
          <input
            id="brief-ads-amount"
            inputMode="numeric"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            autoFocus
          />
          <span className="muted">{ads.currency} a month</span>
          <SubmitButton className="button button-secondary button-small">
            Set
          </SubmitButton>
        </form>
      ) : (
        <PlanNote
          {...props}
          placeholder="Or say what to change about the ads"
          onRefused={setNoteRefusal}
        />
      )}
      {refusal || noteRefusal ? (
        <Refusal
          text={(refusal ?? noteRefusal) as string}
          topUpUrl={overview.subscribeUrl}
        />
      ) : null}
    </Bubble>
  );
}

function Approve(props: ChatAskProps & { canApprove: boolean }) {
  const { overview, handlers, canApprove } = props;
  const { pending, refusal, run } = useRun();
  const [noteRefusal, setNoteRefusal] = useState<string | null>(null);
  if (!canApprove) {
    return (
      <Bubble
        question="Your month is ready for approval."
        sub="Only an owner or admin of this workspace can approve. I wait until one does."
      />
    );
  }
  return (
    <Bubble
      question="Ready to approve your month?"
      sub="Only an owner or admin of this workspace can approve."
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
        placeholder="Or change something first"
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
  const open = connect.networks.filter((network) => !network.connected);
  const names = (list: typeof open) =>
    joinNames(list.map((network) => channelLabel(network.key)));
  const connectButtons = open.map((network) => (
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
            ? "Connect at least one place week one posts to."
            : "Your plan posts nowhere I can connect yet. Launch when you're ready."
        }
        sub="A window opens for each network. One is enough to launch."
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
            ? `${names(open)} pieces wait as drafts until you connect ${open.length === 1 ? "it" : "them"}.`
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

/** The count beside "needs you" for each ask. */
export function askCount(ask: Ask, overview: CmoOverview): string {
  const total = briefSteps(overview).length;
  switch (ask.kind) {
    case "brand-question":
      return `${ask.index + 1} of ${ask.total}`;
    case "plan-question":
      return `question ${ask.index + 1} of ${ask.total}`;
    case "briefing-plan":
      return `briefing 1 of ${total}`;
    case "briefing-week":
      return `briefing 2 of ${total}`;
    case "briefing-ads":
      return `briefing ${total} of ${total}`;
    default:
      return "1 of 1";
  }
}

/** A key per ask, so the chat knows when it moved on. */
export function askKey(ask: Ask): string {
  return "id" in ask ? `${ask.kind}:${ask.id}` : ask.kind;
}

"use client";

import type { BuzzConnection } from "@sokosumi/core-client";
import { getBuzzConnectionResponseTransformer } from "@sokosumi/core-client/transformers";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Copy,
  Download,
  KeyRound,
  Link2,
  LogIn,
  MessageCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useState } from "react";

import {
  BUZZ_ACTION_STYLE,
  BuzzIconTile,
  BuzzLogo,
  BuzzSurface,
} from "@/components/buzz/buzz-brand";
import { fetchBackgroundJson } from "@/components/chat/fetch-background-json";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useClipboard } from "@/hooks/use-clipboard";
import { linkBuzzApp, revealBuzzSecretKey } from "@/lib/actions/buzz/action";
import { cn } from "@/lib/utils";

/** Where Buzz is downloaded: the app's own releases. */
const BUZZ_DOWNLOAD_URL = "https://github.com/block/buzz-app/releases/latest";
const POLL_MS = 3000;

export const BUZZ_CONNECTION_QUERY_KEY = ["buzz-connection"] as const;

type Step =
  | "choose"
  | "new-get"
  | "new-key"
  | "new-signin"
  | "new-hello"
  | "have-key"
  | "have-join"
  | "done";

const NEW_PATH: Step[] = [
  "choose",
  "new-get",
  "new-key",
  "new-signin",
  "new-hello",
  "done",
];
const HAVE_PATH: Step[] = ["choose", "have-key", "have-join", "done"];

type Invite = { organizationName: string; joinUrl: string; inviteUrl: string };

/** A background read (route handler), so polling never queues actions. */
export async function fetchBuzzConnection(): Promise<BuzzConnection> {
  const response = await fetchBackgroundJson("/api/buzz/connection", 10_000);
  return (await getBuzzConnectionResponseTransformer(response)).data;
}

/**
 * Connect Buzz, one step at a time. New to Buzz: get the app, save your key,
 * sign in with it, say hello (which is how we know it worked). Already on
 * Buzz: give us your Buzz key and join with the invite; your Buzz identity is
 * then yours here too.
 */
export function BuzzConnectDialog({
  open,
  onOpenChange,
  onNotNow,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Offered on the first screen when the dialog came from a reminder. */
  onNotNow?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <BuzzConnectFlow
          onClose={() => onOpenChange(false)}
          onNotNow={onNotNow}
        />
      ) : null}
    </Dialog>
  );
}

function BuzzConnectFlow({
  onClose,
  onNotNow,
}: {
  onClose: () => void;
  onNotNow?: () => void;
}) {
  const t = useTranslations("Components.BuzzConnect");
  const queryClient = useQueryClient();
  // Buzz's own labels stand out, so they are easy to find in the app.
  const label = (chunks: ReactNode) => (
    <strong className="text-foreground font-semibold">{chunks}</strong>
  );
  const [step, setStep] = useState<Step>("choose");
  const [openedAt] = useState(() => Date.now());
  const [keySaved, setKeySaved] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [publicKey, setPublicKey] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [via, setVia] = useState<"sokosumi" | "app">("sokosumi");

  const path = step.startsWith("have") || via === "app" ? HAVE_PATH : NEW_PATH;
  const index = path.indexOf(step);
  const waiting = step === "new-hello" || step === "have-join";

  // Polled only while a step waits on Buzz; it ends the wait on its own.
  const connection = useQuery({
    queryKey: BUZZ_CONNECTION_QUERY_KEY,
    queryFn: fetchBuzzConnection,
    refetchInterval: waiting ? POLL_MS : false,
  });
  const data = connection.data;
  const lastActive = data?.lastActiveOnBuzzAt
    ? new Date(data.lastActiveOnBuzzAt).getTime()
    : null;
  if (step === "new-hello" && lastActive !== null && lastActive >= openedAt) {
    setVia("sokosumi");
    setStep("done");
  }
  if (step === "have-join" && data?.app?.status === "linked") {
    setVia("app");
    setStep("done");
  }

  const hosts = [
    ...new Set((data?.communities ?? []).map((c) => new URL(c.relayUrl).host)),
  ];

  const focusHeading = useCallback((node: HTMLHeadingElement | null) => {
    node?.focus({ preventScroll: true });
  }, []);

  async function saveKeyFile() {
    setSavingKey(true);
    const result = await revealBuzzSecretKey({});
    setSavingKey(false);
    if (!result.ok) return;
    const file = new Blob([result.value.nsec], { type: "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(file);
    link.download = "sokosumi-buzz-key.txt";
    link.click();
    URL.revokeObjectURL(link.href);
    setKeySaved(true);
  }

  async function link() {
    setLinking(true);
    setKeyError(null);
    const result = await linkBuzzApp({ publicKey });
    setLinking(false);
    if (!result.ok) {
      setKeyError(result.error.message);
      return;
    }
    setInvites(result.value.invites);
    await queryClient.invalidateQueries({
      queryKey: BUZZ_CONNECTION_QUERY_KEY,
    });
    setStep("have-join");
  }

  function finish() {
    void queryClient.invalidateQueries({ queryKey: BUZZ_CONNECTION_QUERY_KEY });
    onClose();
  }

  const back = () => setStep(path[Math.max(0, index - 1)] ?? "choose");
  const next = () => setStep(path[index + 1] ?? "done");

  return (
    <DialogContent className="bg-background top-0 left-0 grid h-dvh w-screen max-w-none! translate-x-0 translate-y-0 grid-rows-[auto_1fr_auto] gap-0 overflow-hidden rounded-none border-0 p-0 sm:top-[50%] sm:left-[50%] sm:h-[600px] sm:max-h-[92dvh] sm:w-[calc(100vw-4rem)] sm:max-w-xl! sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-2xl sm:border [&>button]:top-5 [&>button]:right-5 sm:[&>button]:top-6 sm:[&>button]:right-6">
      <DialogTitle className="sr-only">{t("dialogTitle")}</DialogTitle>
      <DialogDescription className="sr-only">{t("subtitle")}</DialogDescription>

      <div className="flex h-16 items-center gap-2 px-6 sm:px-8">
        <BuzzLogo className="size-6 rounded-md" />
        <span className="text-[15px] font-semibold tracking-[-0.01em]">
          Buzz
        </span>
      </div>

      <div className="app-scrollbar flex min-h-0 flex-col items-center overflow-y-auto overscroll-contain px-6 py-4 text-center sm:px-14">
        <div
          key={step}
          className="animate-in fade-in-0 slide-in-from-bottom-1 my-auto w-full duration-200 ease-out motion-reduce:animate-none"
        >
          {step === "choose" && (
            <Stage
              hero={null}
              title={t("title")}
              subtitle={t("subtitle")}
              headingRef={focusHeading}
            >
              <div className="mx-auto grid w-full max-w-md gap-3 text-left sm:grid-cols-2">
                <Choice
                  brand
                  title={t("choose.newTitle")}
                  description={t("choose.newDescription")}
                  onSelect={() => {
                    setVia("sokosumi");
                    setStep("new-get");
                  }}
                />
                <Choice
                  title={t("choose.haveTitle")}
                  description={t("choose.haveDescription")}
                  onSelect={() => {
                    setVia("app");
                    setStep("have-key");
                  }}
                />
              </div>
            </Stage>
          )}

          {step === "new-get" && (
            <Stage
              hero={
                <BuzzIconTile>
                  <Download />
                </BuzzIconTile>
              }
              title={t("get.title")}
              subtitle={t("get.subtitle")}
              headingRef={focusHeading}
            >
              <Button
                asChild
                variant="outline"
                size="lg"
                className="h-11 rounded-full"
              >
                <a href={BUZZ_DOWNLOAD_URL} target="_blank" rel="noreferrer">
                  <BuzzLogo className="size-5 rounded-sm" />
                  {t("get.download")}
                </a>
              </Button>
              <p className="text-muted-foreground mx-auto mt-4 max-w-[40ch] text-xs text-balance">
                {t.rich("signin.otherIdentity", { b: label })}
              </p>
            </Stage>
          )}

          {step === "new-key" && (
            <Stage
              hero={
                <BuzzIconTile>
                  {keySaved ? <Check strokeWidth={2.5} /> : <KeyRound />}
                </BuzzIconTile>
              }
              title={t("key.title")}
              subtitle={t("key.subtitle")}
              headingRef={focusHeading}
            >
              <Button
                variant="outline"
                size="lg"
                className="h-11 rounded-full"
                loading={savingKey}
                onClick={saveKeyFile}
              >
                {keySaved ? (
                  <Check className="size-4" />
                ) : (
                  <Download className="size-4" />
                )}
                {keySaved ? t("key.saved") : t("key.save")}
              </Button>
              <p className="text-muted-foreground mx-auto mt-4 max-w-[40ch] text-sm text-balance">
                {t("key.warning")}
              </p>
            </Stage>
          )}

          {step === "new-signin" && (
            <Stage
              hero={
                <BuzzIconTile>
                  <LogIn />
                </BuzzIconTile>
              }
              title={t("signin.title")}
              subtitle={t("signin.subtitle")}
              headingRef={focusHeading}
            >
              <ol className="bg-card mx-auto w-full max-w-sm divide-y overflow-hidden rounded-xl border text-left text-sm">
                <Instruction n={1}>{t("signin.open")}</Instruction>
                <Instruction n={2}>
                  {t.rich("signin.options", { b: label })}
                </Instruction>
                <Instruction n={3}>
                  <span className="block">{t("signin.address")}</span>
                  {hosts.map((host) => (
                    <CopyChip key={host} value={host} />
                  ))}
                </Instruction>
                <Instruction n={4}>
                  {t.rich("signin.key", { b: label })}
                </Instruction>
              </ol>
            </Stage>
          )}

          {step === "new-hello" && (
            <Stage
              hero={
                <BuzzIconTile>
                  <MessageCircle />
                </BuzzIconTile>
              }
              title={t("hello.title")}
              subtitle={t("hello.subtitle")}
              headingRef={focusHeading}
            >
              <Waiting label={t("hello.waiting")} />
            </Stage>
          )}

          {step === "have-key" && (
            <Stage
              hero={
                <BuzzIconTile>
                  <KeyRound />
                </BuzzIconTile>
              }
              title={t("have.title")}
              subtitle={t.rich("have.subtitle", { b: label })}
              headingRef={focusHeading}
            >
              <form
                id="buzz-connect-key"
                className="mx-auto w-full max-w-sm text-left"
                onSubmit={(event) => {
                  event.preventDefault();
                  void link();
                }}
              >
                <Input
                  value={publicKey}
                  onChange={(event) => {
                    setPublicKey(event.target.value);
                    setKeyError(null);
                  }}
                  placeholder="npub1…"
                  aria-label={t("have.label")}
                  aria-invalid={keyError ? true : undefined}
                  aria-describedby={
                    keyError ? "buzz-connect-key-error" : undefined
                  }
                  autoComplete="off"
                  spellCheck={false}
                  className="h-11 font-mono text-sm"
                />
                {keyError ? (
                  <p
                    id="buzz-connect-key-error"
                    role="alert"
                    className="text-destructive mt-2 text-sm"
                  >
                    {keyError}
                  </p>
                ) : null}
              </form>
              <p className="text-muted-foreground mx-auto mt-4 max-w-[40ch] text-xs text-balance">
                {t("have.agentsNote")}
              </p>
            </Stage>
          )}

          {step === "have-join" && (
            <Stage
              hero={
                <BuzzIconTile>
                  <Link2 />
                </BuzzIconTile>
              }
              title={t("join.title")}
              subtitle={t.rich("join.subtitle", { b: label })}
              headingRef={focusHeading}
            >
              <div className="flex flex-col items-center gap-2">
                {invites.map((invite) => (
                  <Button
                    key={invite.joinUrl}
                    asChild
                    variant="outline"
                    size="lg"
                    className="h-11 rounded-full"
                  >
                    <a href={invite.joinUrl}>
                      <BuzzLogo className="size-5 rounded-sm" />
                      {invites.length > 1
                        ? t("join.openNamed", { name: invite.organizationName })
                        : t("join.open")}
                    </a>
                  </Button>
                ))}
                {invites[0] ? (
                  <CopyChip
                    value={invites[0].inviteUrl}
                    label={t("join.copyInvite")}
                  />
                ) : null}
              </div>
              <Waiting label={t("join.waiting")} />
            </Stage>
          )}

          {step === "done" && (
            <Stage
              hero={
                <BuzzIconTile>
                  <Check strokeWidth={2.5} />
                </BuzzIconTile>
              }
              title={via === "app" ? t("done.appTitle") : t("done.title")}
              subtitle={
                via === "app" ? t("done.appSubtitle") : t("done.subtitle")
              }
              headingRef={focusHeading}
            />
          )}
        </div>
      </div>

      {/* Footer: one filled action at a time, Back on the left. */}
      <div className="bg-background relative flex min-h-20 items-center justify-between gap-3 px-6 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-8">
        {step !== "choose" && step !== "done" ? (
          <Button
            variant="ghost"
            className="text-muted-foreground h-11 px-4"
            onClick={back}
          >
            {t("back")}
          </Button>
        ) : step === "choose" && onNotNow ? (
          <Button
            variant="ghost"
            className="text-muted-foreground h-11 px-4"
            onClick={onNotNow}
          >
            {t("notNow")}
          </Button>
        ) : (
          <span />
        )}

        {step !== "choose" && step !== "done" ? (
          <StepDots total={path.length - 2} current={index - 1} />
        ) : null}

        {step === "new-get" && (
          <Button
            variant="primary"
            size="lg"
            style={BUZZ_ACTION_STYLE}
            className="rounded-full h-11 px-6"
            onClick={next}
          >
            {t("get.next")}
          </Button>
        )}
        {step === "new-key" && (
          <Button
            variant="primary"
            size="lg"
            style={BUZZ_ACTION_STYLE}
            className="rounded-full h-11 px-6"
            onClick={next}
            disabled={!keySaved}
          >
            {t("next")}
          </Button>
        )}
        {step === "new-signin" && (
          <Button
            variant="primary"
            size="lg"
            style={BUZZ_ACTION_STYLE}
            className="rounded-full h-11 px-6"
            onClick={next}
          >
            {t("signin.next")}
          </Button>
        )}
        {step === "have-key" && (
          <Button
            type="submit"
            form="buzz-connect-key"
            variant="primary"
            size="lg"
            style={BUZZ_ACTION_STYLE}
            className="rounded-full h-11 px-6"
            loading={linking}
            disabled={!publicKey.trim()}
          >
            {t("next")}
          </Button>
        )}
        {waiting && (
          <Button variant="ghost" className="h-11 px-4" onClick={finish}>
            {t("later")}
          </Button>
        )}
        {step === "done" && (
          <Button
            variant="primary"
            size="lg"
            style={BUZZ_ACTION_STYLE}
            className="rounded-full h-11 px-6"
            onClick={finish}
          >
            {t("done.close")}
          </Button>
        )}
      </div>
    </DialogContent>
  );
}

function Stage({
  hero,
  title,
  subtitle,
  headingRef,
  children,
}: {
  hero: ReactNode | null;
  title: string;
  subtitle: ReactNode;
  headingRef: (node: HTMLHeadingElement | null) => void;
  children?: ReactNode;
}) {
  return (
    <div>
      {hero ? (
        <div className="flex min-h-16 items-center justify-center">{hero}</div>
      ) : null}
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="mt-6 text-[28px] leading-[1.15] font-semibold tracking-[-0.02em] text-balance outline-none"
      >
        {title}
      </h2>
      <p className="text-muted-foreground mx-auto mt-2 max-w-[42ch] text-base leading-[1.6] text-balance">
        {subtitle}
      </p>
      {children ? <div className="mt-6">{children}</div> : null}
    </div>
  );
}

/**
 * One way in, as a card: the main path in Buzz's own colors, the other
 * white with a hairline. Pressed, not hovered.
 */
function Choice({
  brand = false,
  title,
  description,
  onSelect,
}: {
  brand?: boolean;
  title: string;
  description: string;
  onSelect: () => void;
}) {
  const body = (
    <span className="flex min-h-24 flex-col p-4 sm:min-h-32">
      <span className="block text-base leading-tight font-semibold tracking-[-0.01em]">
        {title}
      </span>
      <span
        className={cn(
          "mt-1 block text-sm leading-snug",
          !brand && "text-muted-foreground",
        )}
      >
        {description}
      </span>
    </span>
  );
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "press focus-visible:ring-ring block w-full overflow-hidden rounded-2xl text-left focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden",
        !brand && "bg-card border",
      )}
    >
      {brand ? (
        <BuzzSurface bees={false} className="h-full rounded-2xl">
          {body}
        </BuzzSurface>
      ) : (
        body
      )}
    </button>
  );
}

/** Where you are in the steps, as small dots between Back and the action. */
function StepDots({ total, current }: { total: number; current: number }) {
  return (
    <span
      className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 gap-1.5"
      aria-hidden
    >
      {Array.from({ length: total }).map((_, dot) => (
        <span
          key={dot}
          className={cn(
            "size-1.5 rounded-full transition-colors duration-200",
            dot === current ? "bg-foreground" : "bg-foreground/15",
          )}
        />
      ))}
    </span>
  );
}

function Instruction({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums">
        {n}
      </span>
      <span className="min-w-0 flex-1 pt-0.5">{children}</span>
    </li>
  );
}

function CopyChip({ value, label }: { value: string; label?: string }) {
  const t = useTranslations("Components.BuzzConnect");
  const { copied, copy } = useClipboard({
    copySuccessMessage: t("copied"),
    copyErrorMessage: t("copyFailed"),
  });
  return (
    <button
      type="button"
      onClick={() => void copy(value)}
      className={cn(
        "press focus-visible:ring-ring mt-2 inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-hidden",
        label
          ? "text-muted-foreground hover:text-foreground"
          : "bg-muted hover:bg-quinary font-mono",
      )}
    >
      <span className="truncate">{label ?? value}</span>
      {copied ? (
        <Check className="size-3.5 shrink-0" />
      ) : (
        <Copy className="size-3.5 shrink-0" />
      )}
    </button>
  );
}

function Waiting({ label }: { label: string }) {
  return (
    <p
      className="text-muted-foreground mt-6 inline-flex items-center gap-2 text-sm"
      aria-live="polite"
    >
      <span className="relative flex size-2">
        <span className="bg-foreground absolute inline-flex size-full animate-ping rounded-full motion-reduce:animate-none" />
        <span className="bg-foreground relative inline-flex size-2 rounded-full" />
      </span>
      {label}
    </p>
  );
}

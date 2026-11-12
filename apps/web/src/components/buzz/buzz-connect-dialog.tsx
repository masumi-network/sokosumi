"use client";

import type { BuzzConnection } from "@sokosumi/core-client";
import { getBuzzConnectionResponseTransformer } from "@sokosumi/core-client/transformers";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Download, Link2, UserPlus } from "lucide-react";
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
import { linkBuzzApp } from "@/lib/actions/buzz/action";
import { cn } from "@/lib/utils";

/** Buzz's own page for authorizing another app's key. */
const BUZZ_SECURITY_URL = "buzz://settings?section=security";
/** Where Buzz is downloaded: the app's own releases. */
const BUZZ_DOWNLOAD_URL = "https://github.com/block/buzz-app/releases/latest";

export const BUZZ_CONNECTION_QUERY_KEY = ["buzz-connection"] as const;

type Step =
  | "choose"
  | "new-get"
  | "new-create"
  | "link-join"
  | "authorize"
  | "done";

const NEW_PATH: Step[] = [
  "choose",
  "new-get",
  "new-create",
  "authorize",
  "link-join",
  "done",
];
const HAVE_PATH: Step[] = ["choose", "authorize", "link-join", "done"];

type Invite = { organizationName: string; joinUrl: string; inviteUrl: string };

/** A background read (route handler), so polling never queues actions. */
export async function fetchBuzzConnection(): Promise<BuzzConnection> {
  const response = await fetchBackgroundJson("/api/buzz/connection", 10_000);
  return (await getBuzzConnectionResponseTransformer(response)).data;
}

/**
 * Connect Buzz, one step at a time. New to Buzz: get the app and make an
 * identity there. Then, for everyone: authorize Sokosumi in Buzz and paste
 * the proof back (it names their Buzz key, so nothing else is asked), and
 * join with the invite. Their private key never leaves Buzz.
 */
export function BuzzConnectDialog({
  open,
  onOpenChange,
  onNotNow,
  resume = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Offered on the first screen when the dialog came from a reminder. */
  onNotNow?: () => void;
  /** Linked but not yet authorized: start at the last step. */
  resume?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <BuzzConnectFlow
          onClose={() => onOpenChange(false)}
          onNotNow={onNotNow}
          resume={resume}
        />
      ) : null}
    </Dialog>
  );
}

function BuzzConnectFlow({
  onClose,
  onNotNow,
  resume,
}: {
  onClose: () => void;
  onNotNow?: () => void;
  resume: boolean;
}) {
  const t = useTranslations("Components.BuzzConnect");
  const queryClient = useQueryClient();
  // Buzz's own labels stand out, so they are easy to find in the app.
  const label = (chunks: ReactNode) => (
    <strong className="text-foreground font-semibold">{chunks}</strong>
  );
  const [step, setStep] = useState<Step>(resume ? "authorize" : "choose");
  const [isNew, setIsNew] = useState(false);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [proof, setProof] = useState("");
  const [proofError, setProofError] = useState<string | null>(null);
  const [authorizing, setAuthorizing] = useState(false);

  const path = isNew ? NEW_PATH : HAVE_PATH;
  const index = path.indexOf(step);

  const connection = useQuery({
    queryKey: BUZZ_CONNECTION_QUERY_KEY,
    queryFn: fetchBuzzConnection,
  });
  const data = connection.data;

  const hosts = [
    ...new Set((data?.communities ?? []).map((c) => new URL(c.relayUrl).host)),
  ];

  const focusHeading = useCallback((node: HTMLHeadingElement | null) => {
    node?.focus({ preventScroll: true });
  }, []);

  async function authorize() {
    setAuthorizing(true);
    setProofError(null);
    const result = await linkBuzzApp({ proof });
    setAuthorizing(false);
    if (!result.ok) {
      setProofError(result.error.message);
      return;
    }
    await queryClient.invalidateQueries({
      queryKey: BUZZ_CONNECTION_QUERY_KEY,
    });
    // An identity already linked needs no invite.
    setInvites(result.value.invites);
    setStep(result.value.invites.length > 0 ? "link-join" : "done");
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
        <span className="text-base font-semibold tracking-[-0.01em]">Buzz</span>
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
                    setIsNew(true);
                    setStep("new-get");
                  }}
                />
                <Choice
                  title={t("choose.haveTitle")}
                  description={t("choose.haveDescription")}
                  onSelect={() => {
                    setIsNew(false);
                    setStep("authorize");
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
            </Stage>
          )}

          {step === "new-create" && (
            <Stage
              hero={
                <BuzzIconTile>
                  <UserPlus />
                </BuzzIconTile>
              }
              title={t("create.title")}
              subtitle={t("create.subtitle")}
              headingRef={focusHeading}
            >
              <ol className="bg-card mx-auto w-full max-w-sm divide-y overflow-hidden rounded-xl border text-left text-sm">
                <Instruction n={1}>
                  {t.rich("create.options", { b: label })}
                </Instruction>
                <Instruction n={2}>
                  <span className="block">{t("create.address")}</span>
                  {hosts.map((host) => (
                    <CopyChip key={host} value={host} />
                  ))}
                </Instruction>
                <Instruction n={3}>
                  {t.rich("create.identity", { b: label })}
                </Instruction>
              </ol>
              <p className="text-muted-foreground mx-auto mt-4 max-w-[40ch] text-xs text-balance">
                {t("create.otherIdentity")}
              </p>
            </Stage>
          )}

          {step === "link-join" && (
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
            </Stage>
          )}

          {step === "authorize" && (
            <Stage
              hero={null}
              title={t("authorize.title")}
              subtitle={t("authorize.subtitle")}
              headingRef={focusHeading}
            >
              <ol className="bg-card mx-auto w-full max-w-sm divide-y overflow-hidden rounded-xl border text-left text-sm">
                <Instruction n={1}>
                  <span className="block">
                    {t.rich("authorize.open", { b: label })}
                  </span>
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="mt-2 h-8 rounded-full"
                  >
                    <a href={BUZZ_SECURITY_URL}>
                      <BuzzLogo className="size-4 rounded-sm" />
                      {t("authorize.openButton")}
                    </a>
                  </Button>
                </Instruction>
                <Instruction n={2}>
                  <span className="block">
                    {t.rich("authorize.paste", { b: label })}
                  </span>
                  {data?.identity ? (
                    <CopyChip value={data.identity.pubkey} />
                  ) : null}
                </Instruction>
                <Instruction n={3}>
                  {t.rich("authorize.confirm", { b: label })}
                  <form
                    id="buzz-connect-proof"
                    className="mt-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void authorize();
                    }}
                  >
                    <Input
                      value={proof}
                      onChange={(event) => {
                        setProof(event.target.value);
                        setProofError(null);
                      }}
                      placeholder={t("authorize.placeholder")}
                      aria-label={t("authorize.label")}
                      aria-invalid={proofError ? true : undefined}
                      aria-describedby={
                        proofError ? "buzz-connect-proof-error" : undefined
                      }
                      autoComplete="off"
                      spellCheck={false}
                      className="h-9 font-mono text-xs"
                    />
                    {proofError ? (
                      <p
                        id="buzz-connect-proof-error"
                        role="alert"
                        className="text-destructive mt-2 text-sm"
                      >
                        {proofError}
                      </p>
                    ) : null}
                  </form>
                </Instruction>
              </ol>
            </Stage>
          )}

          {step === "done" && (
            <Stage
              hero={
                <BuzzIconTile>
                  <Check strokeWidth={2.5} />
                </BuzzIconTile>
              }
              title={t("done.title")}
              subtitle={t("done.subtitle")}
              headingRef={focusHeading}
            />
          )}
        </div>
      </div>

      {/* Footer: one filled action at a time, Back on the left. */}
      <div className="bg-background relative flex min-h-20 items-center justify-between gap-3 px-6 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-8">
        {step === "authorize" && resume ? (
          <Button
            variant="ghost"
            className="text-muted-foreground h-11 px-4"
            onClick={finish}
          >
            {t("later")}
          </Button>
        ) : step !== "choose" && step !== "done" ? (
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
        {step === "new-create" && (
          <Button
            variant="primary"
            size="lg"
            style={BUZZ_ACTION_STYLE}
            className="rounded-full h-11 px-6"
            onClick={next}
          >
            {t("create.next")}
          </Button>
        )}
        {step === "authorize" && (
          <Button
            type="submit"
            form="buzz-connect-proof"
            variant="primary"
            size="lg"
            style={BUZZ_ACTION_STYLE}
            className="rounded-full h-11 px-6"
            loading={authorizing}
            disabled={!proof.trim()}
          >
            {t("authorize.save")}
          </Button>
        )}
        {step === "link-join" && (
          <Button
            variant="primary"
            size="lg"
            style={BUZZ_ACTION_STYLE}
            className="rounded-full h-11 px-6"
            onClick={next}
          >
            {t("join.next")}
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
        className="mt-6 text-3xl leading-[1.1] font-semibold tracking-[-0.02em] text-balance outline-none"
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
            dot === current ? "bg-foreground" : "bg-border",
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

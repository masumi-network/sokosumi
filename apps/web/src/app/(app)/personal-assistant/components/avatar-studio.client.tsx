"use client";

import {
  type SokoBotAvatarChange,
  SokoBotAvatarState,
  type SokoBotAvatarStudio,
} from "@sokosumi/core-client";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import * as z from "zod";

import { AvatarFace } from "@/components/soko-bot/avatar-face";
import { AvatarLoop } from "@/components/soko-bot/avatar-loop";
import {
  useAvatarStateCopy,
  usePlayOnce,
} from "@/components/soko-bot/avatar-state";
import { Button } from "@/components/ui/button";
import { ButtonLoadingBar } from "@/components/ui/button-loading-bar";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { Input } from "@/components/ui/input";
import {
  createSokoBotAvatarDraftAction,
  discardSokoBotAvatarDraftsAction,
  keepSokoBotAvatarDraftAction,
  regenerateSokoBotAvatarStateAction,
} from "@/lib/actions/soko-bot/action";
import { avatarSources, isCraftedAvatar } from "@/lib/soko-bot/avatar";
import { withBotIdParam } from "@/lib/soko-bot/bot-id-param";
import {
  SOKO_BOT_AVATAR_RATE_LIMITED_ERROR_CODE,
  SOKO_BOT_AVATAR_REDO_LIMIT_ERROR_CODE,
  SOKO_BOT_AVATAR_STATE_RENDERING_ERROR_CODE,
  SOKO_BOT_AVATAR_UNAVAILABLE_ERROR_CODE,
} from "@/lib/soko-bot/constants";
import { cn } from "@/lib/utils";

const STATES = Object.values(SokoBotAvatarState);
/** Original ideas only: a typed change that names a brand or a character is refused. */
const IDEAS = ["wizard", "coffee", "snow", "sleepy", "beach"] as const;
const PREVIEW_SIZES = ["size-20", "size-12", "size-8", "size-6"] as const;
const POLL_ENDPOINT = "/api/personal-assistant/avatar";
const POLL_MS = 5_000;

type Progress = SokoBotAvatarStudio["progress"];

/** Plain words for the errors that are not a generic "try again". */
const FAILURE_COPY = {
  [SOKO_BOT_AVATAR_RATE_LIMITED_ERROR_CODE]: "rateLimited",
  [SOKO_BOT_AVATAR_UNAVAILABLE_ERROR_CODE]: "unavailable",
  [SOKO_BOT_AVATAR_REDO_LIMIT_ERROR_CODE]: "redoLimit",
  [SOKO_BOT_AVATAR_STATE_RENDERING_ERROR_CODE]: "redoBusy",
} as const;

/** The loops being redone, each with the loop it had when the redo began. */
type Redoing = Partial<Record<SokoBotAvatarState, string | null>>;

const stateAssetsSchema = z.object({
  stillUrl: z.string(),
  loopUrl: z.string().nullable(),
  loopLargeUrl: z.string().nullable(),
});

/** What the poll needs from the studio: the avatar view and render progress. */
const pollResponseSchema = z.object({
  studio: z.object({
    avatar: z
      .object({
        styleId: z.string(),
        styleVersion: z.number(),
        stillUrl: z.string(),
        states: z.record(
          z.enum(SokoBotAvatarState),
          stateAssetsSchema.nullable(),
        ),
      })
      .nullable(),
    progress: z.object({
      ready: z.number(),
      failed: z.number(),
      total: z.number(),
    }),
  }),
});

function isRendering({ ready, failed, total }: Progress): boolean {
  return total > 0 && ready + failed < total;
}

function canRetryMissingStill(
  still: string | null,
  progress: Progress,
  rendering: boolean,
): boolean {
  return (
    still === null && !rendering && progress.failed > 0 && progress.total > 0
  );
}

/** "wizard-hat" → "Wizard hat": a style option that has no translation yet. */
function humanise(id: string): string {
  const words = id.replace(/[-_]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

interface AvatarStudioProps {
  /** The shared bot being edited; null for the caller's own. */
  botId: string | null;
  botName: string;
  consoleHref: string;
  initial: SokoBotAvatarStudio;
}

/**
 * Where the owner changes a bot's look: one change at a time makes a draft,
 * and Keep makes the draft the avatar. A kept look then renders its states in
 * the background, which this page polls until they are ready.
 */
export function AvatarStudio({
  botId,
  botName,
  consoleHref,
  initial,
}: AvatarStudioProps) {
  const t = useTranslations("App.SokoBot.Avatar.Studio");
  const { label: stateLabel, alt } = useAvatarStateCopy();
  const router = useRouter();
  const [studio, setStudio] = useState(initial);
  const [draft, setDraft] = useState(initial.draft);
  const [note, setNote] = useState("");
  const [typed, setTyped] = useState("");
  const [saved, setSaved] = useState(false);
  const [pick, setPick] = useState<{ state: SokoBotAvatarState; n: number }>({
    state: SokoBotAvatarState.IDLE,
    n: 0,
  });
  const [isDrafting, startDrafting] = useTransition();
  const [isKeeping, startKeeping] = useTransition();
  const [isCancelling, startCancelling] = useTransition();
  const [isRedoing, startRedoing] = useTransition();
  const [redoing, setRedoing] = useState<Redoing>({});
  const busy = isDrafting || isKeeping || isCancelling || isRedoing;
  // Picking a state plays it once, then it rests on its still.
  const pickKey = `${pick.state}:${pick.n}`;
  const [playing, stop] = usePlayOnce(pickKey, false);

  const rendering = isRendering(studio.progress);
  useEffect(() => {
    if (!rendering) return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(withBotIdParam(POLL_ENDPOINT, botId), {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok || stopped) return;
        const body = pollResponseSchema.safeParse(await response.json());
        if (!body.success || stopped) return;
        const next = body.data.studio;
        setStudio((prev) => ({
          ...prev,
          avatar: next.avatar,
          progress: next.progress,
        }));
        // Sidebar and console show the new states once they are ready.
        if (!isRendering(next.progress)) router.refresh();
      } catch {
        // Offline: the next tick retries.
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [rendering, botId, router]);

  /** A style option's name: translated when we know it, else made readable. */
  function optionLabel(group: "creatures" | "accessories", id: string) {
    return t.has(`${group}.${id}`) ? t(`${group}.${id}`) : humanise(id);
  }

  function toastFailure(code: string, fallback: string) {
    const copy = FAILURE_COPY[code as keyof typeof FAILURE_COPY];
    toast.error(copy ? t(copy) : fallback);
  }

  /** Redoes the picked state's animation; its old loop keeps playing meanwhile. */
  function handleRedo() {
    const state = pick.state;
    const oldLoop = studio.avatar?.states[state]?.loopLargeUrl ?? null;
    startRedoing(async () => {
      const result = await regenerateSokoBotAvatarStateAction({
        botId: botId ?? undefined,
        state,
      });
      if (!result.ok) {
        toastFailure(result.error.code, t("redoError"));
        return;
      }
      setRedoing((prev) => ({ ...prev, [state]: oldLoop }));
      setStudio(result.value);
    });
  }

  function handleChange(next: SokoBotAvatarChange) {
    startDrafting(async () => {
      const result = await createSokoBotAvatarDraftAction({
        botId: botId ?? undefined,
        input: {
          change: next,
          draftId: next.kind === "shuffle" ? undefined : draft?.id,
        },
      });
      if (!result.ok) {
        toastFailure(result.error.code, t("error"));
        return;
      }
      // A refusal answers with a note and no draft: the look stays as it was.
      setNote(result.value.note);
      if (result.value.draft) {
        setDraft(result.value.draft);
        setSaved(false);
        if (next.kind === "typed") setTyped("");
      }
    });
  }

  function handleKeep() {
    if (!draft) return;
    const draftId = draft.id;
    startKeeping(async () => {
      const result = await keepSokoBotAvatarDraftAction({
        botId: botId ?? undefined,
        draftId,
      });
      if (!result.ok) {
        toastFailure(result.error.code, t("keepError"));
        return;
      }
      setStudio(result.value);
      setDraft(null);
      setNote("");
      setSaved(true);
      setPick({ state: SokoBotAvatarState.IDLE, n: 0 });
      router.refresh();
    });
  }

  /** Drops every open draft and goes back to the kept look. */
  function handleCancel() {
    startCancelling(async () => {
      const result = await discardSokoBotAvatarDraftsAction({
        botId: botId ?? undefined,
      });
      if (!result.ok) {
        toastFailure(result.error.code, t("cancelError"));
        return;
      }
      setStudio(result.value);
      setDraft(null);
      setNote("");
      setSaved(false);
      setPick({ state: SokoBotAvatarState.IDLE, n: 0 });
      router.refresh();
    });
  }

  // A state is being made while the look renders and it has no new loop yet.
  const loopOf = (state: SokoBotAvatarState) =>
    studio.avatar?.states[state]?.loopLargeUrl ?? null;
  const isMaking = (state: SokoBotAvatarState) =>
    rendering &&
    (state in redoing
      ? loopOf(state) === redoing[state]
      : loopOf(state) === null);
  // A redone state whose new loop has landed plays once, picked or not.
  const landed = STATES.filter((state) => state in redoing && !isMaking(state));
  if (landed.length > 0) {
    setRedoing((prev) =>
      Object.fromEntries(
        Object.entries(prev).filter(
          ([state]) => !landed.includes(state as SokoBotAvatarState),
        ),
      ),
    );
    if (
      landed.some(
        (state) =>
          state === pick.state &&
          loopOf(state) !== null &&
          loopOf(state) !== redoing[state],
      )
    ) {
      setPick((prev) => ({ ...prev, n: prev.n + 1 }));
    }
  }
  const pickedAssets = studio.avatar?.states[pick.state] ?? null;
  const pickedMaking = isMaking(pick.state);
  const pickedRetryMissingStill = canRetryMissingStill(
    pickedAssets?.stillUrl ?? null,
    studio.progress,
    rendering,
  );
  // A first loop still on its way has nothing to redo yet; its tile says so.
  const canRedo =
    draft === null &&
    isCraftedAvatar(studio.avatar) &&
    studio.progress.total > 0 &&
    (pickedAssets !== null || pickedRetryMissingStill) &&
    (!pickedMaking || pick.state in redoing);

  const crafted = draft !== null || isCraftedAvatar(studio.avatar);
  const sources = avatarSources(
    studio.avatar,
    pick.state,
    studio.avatar?.stillUrl ?? null,
  );
  const lookImage = draft?.imageUrl ?? studio.avatar?.stillUrl ?? null;
  const lookClass = cn(
    "size-full object-cover transition-opacity duration-200",
    isDrafting && "opacity-45",
  );
  const currentLook = draft?.look ?? studio.look;
  const statesHint =
    draft || !crafted
      ? t("statesDraft")
      : rendering
        ? t("statesProgress", {
            ready: studio.progress.ready,
            total: studio.progress.total,
          })
        : t("statesPlay");

  return (
    <div className="flex w-full flex-col gap-8 py-2">
      <header className="flex flex-col gap-3">
        <Link
          href={consoleHref}
          className="text-muted-foreground press hover:text-foreground inline-flex items-center gap-1.5 self-start text-sm transition-colors"
        >
          <ArrowLeft aria-hidden className="size-4" />
          {t("back", { name: botName })}
        </Link>
        <h1 className="text-foreground text-3xl font-light tracking-tight">
          {t("title", { name: botName })}
        </h1>
        <p className="text-muted-foreground max-w-xl text-sm text-pretty">
          {t("description")}
        </p>
      </header>

      <div className="grid w-full gap-8 lg:grid-cols-[minmax(0,35rem)_minmax(0,1fr)] lg:gap-16">
        <div className="flex min-w-0 flex-col gap-6">
          <div
            aria-busy={isDrafting}
            className="bg-muted relative aspect-square w-full overflow-hidden rounded-2xl"
          >
            {draft ? (
              <img
                src={draft.imageUrl}
                alt={t("draftAlt", { name: botName })}
                className={lookClass}
              />
            ) : sources.still ? (
              <AvatarLoop
                key={pickKey}
                poster={sources.still}
                src={sources.loopLarge}
                playing={playing}
                onEnded={stop}
                alt={alt(botName, pick.state)}
                className={lookClass}
              />
            ) : isDrafting ? null : (
              <p className="text-muted-foreground absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-balance">
                {t("empty")}
              </p>
            )}
            {isDrafting ? (
              <div className="absolute inset-x-0 bottom-6 flex justify-center">
                <span
                  role="status"
                  className="bg-background border-border relative overflow-hidden rounded-lg border px-3.5 py-2.5 text-sm"
                >
                  {t("making")}
                  <ButtonLoadingBar label={t("making")} />
                </span>
              </div>
            ) : null}
          </div>

          {lookImage ? (
            <div className="flex items-end gap-4">
              {PREVIEW_SIZES.map((size) => (
                <AvatarFace
                  key={size}
                  src={lookImage}
                  crafted={crafted}
                  className={size}
                />
              ))}
              <span className="text-muted-foreground ml-auto text-xs">
                {t("sizes")}
              </span>
            </div>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-8">
          <div className={HOLDER_CLASS}>
            <div className={cn(HOLDER_ITEM_CLASS, "flex flex-col gap-6 p-5")}>
              <fieldset className="flex flex-col gap-3">
                <legend className="text-muted-foreground mb-3 text-xs font-medium">
                  {t("creature")}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {studio.options.creatures.map(({ id }) => {
                    const on = currentLook?.creature === id;
                    return (
                      <Button
                        key={id}
                        type="button"
                        size="sm"
                        variant={on ? "default" : "outline"}
                        aria-pressed={on}
                        disabled={busy}
                        className={cn(on && "font-semibold")}
                        onClick={() =>
                          on || handleChange({ kind: "creature", creature: id })
                        }
                      >
                        {optionLabel("creatures", id)}
                      </Button>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset className="flex flex-col gap-3">
                <legend className="text-muted-foreground mb-3 text-xs font-medium">
                  {t("accessory")}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {studio.options.accessories.map(({ id }) => {
                    const on = currentLook?.accessories.includes(id) ?? false;
                    return (
                      <Button
                        key={id}
                        type="button"
                        size="sm"
                        variant={on ? "default" : "outline"}
                        aria-pressed={on}
                        disabled={busy}
                        className={cn(on && "font-semibold")}
                        onClick={() =>
                          handleChange({
                            kind: "accessory",
                            accessory: id,
                            enabled: !on,
                          })
                        }
                      >
                        {optionLabel("accessories", id)}
                      </Button>
                    );
                  })}
                </div>
              </fieldset>

              <form
                className="flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  const text = typed.trim();
                  if (text && !busy) handleChange({ kind: "typed", text });
                }}
              >
                <label
                  htmlFor="avatar-studio-ask"
                  className="text-muted-foreground text-xs font-medium"
                >
                  {t("describe")}
                </label>
                <div className="flex max-w-xl gap-2">
                  <Input
                    id="avatar-studio-ask"
                    value={typed}
                    maxLength={300}
                    placeholder={t("placeholder")}
                    disabled={busy}
                    onChange={(event) => setTyped(event.target.value)}
                  />
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={busy || !typed.trim()}
                  >
                    {t("apply")}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {IDEAS.map((idea) => (
                    <Button
                      key={idea}
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        handleChange({
                          kind: "typed",
                          text: t(`ideas.${idea}`),
                        })
                      }
                    >
                      {t(`ideas.${idea}`)}
                    </Button>
                  ))}
                </div>
                <p
                  role="status"
                  className="text-muted-foreground min-h-5 max-w-xl text-sm"
                >
                  {note}
                </p>
              </form>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="primary"
                  disabled={!draft || busy}
                  loading={isKeeping}
                  onClick={handleKeep}
                >
                  {t("keep")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => handleChange({ kind: "shuffle" })}
                >
                  {t("shuffle")}
                </Button>
                {draft ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={handleCancel}
                  >
                    {t("cancel")}
                  </Button>
                ) : null}
                <p role="status" className="text-muted-foreground ml-2 text-sm">
                  {saved ? t("saved") : ""}
                </p>
              </div>
            </div>
          </div>

          <div className={HOLDER_CLASS}>
            <div className={cn(HOLDER_ITEM_CLASS, "flex flex-col gap-4 p-4")}>
              <div className="flex items-baseline gap-3">
                <h2 className="text-sm font-semibold">{t("states")}</h2>
                <p
                  role="status"
                  className="text-muted-foreground ml-auto text-xs"
                >
                  {statesHint}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                {STATES.map((state) => {
                  const still = studio.avatar?.states[state]?.stillUrl ?? null;
                  const selected = !draft && pick.state === state;
                  const retryMissingStill = canRetryMissingStill(
                    still,
                    studio.progress,
                    rendering,
                  );
                  // While the look renders: no still yet, or a still whose loop is on its way.
                  const progress =
                    draft || !isMaking(state)
                      ? null
                      : still
                        ? t("animating")
                        : t("drawing");
                  return (
                    <button
                      key={state}
                      type="button"
                      disabled={
                        draft !== null || (!still && !retryMissingStill)
                      }
                      aria-pressed={selected}
                      onClick={() =>
                        setPick((prev) => ({ state, n: prev.n + 1 }))
                      }
                      className={cn(
                        "focus-visible:ring-ring flex flex-col items-center gap-1.5 rounded-lg outline-none focus-visible:ring-2",
                        !progress && "disabled:opacity-40",
                      )}
                    >
                      <span
                        className={cn(
                          "bg-muted border-border block aspect-square w-full overflow-hidden rounded-lg border",
                          !still && progress && "motion-safe:animate-pulse",
                          selected &&
                            "ring-foreground ring-offset-background ring-2 ring-offset-2",
                        )}
                      >
                        {still ? (
                          <img
                            src={still}
                            alt=""
                            className={cn(
                              "size-full object-cover transition-opacity duration-200",
                              progress && "opacity-60",
                            )}
                          />
                        ) : null}
                      </span>
                      <span
                        className={cn(
                          "text-xs",
                          selected ? "font-semibold" : "font-medium",
                        )}
                      >
                        {stateLabel(state)}
                      </span>
                      {progress ? (
                        <span className="text-muted-foreground text-2xs">
                          {progress}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              {canRedo ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  disabled={busy || pickedMaking}
                  onClick={handleRedo}
                >
                  {pickedMaking
                    ? t("redoing")
                    : pickedAssets?.loopLargeUrl
                      ? t("redo")
                      : t("retry")}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

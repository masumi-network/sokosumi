"use client";

import {
  AVATAR_ANIMALS,
  AVATAR_BACKGROUNDS,
  AVATAR_CHEEKS,
  AVATAR_COLOURS,
  AVATAR_CORNERS,
  AVATAR_EYES,
  AVATAR_HATS,
  AVATAR_MOUTHS,
  AVATAR_PALETTE,
  AVATAR_SIZES,
  AVATAR_STATES,
  type AvatarAnimal,
  type AvatarColour,
  type AvatarLook,
  type AvatarState,
  featureOptions,
  formatAvatarCode,
  isReadable,
  originalAvatarLook,
  parseAvatarCode,
  randomAvatarLook,
} from "@sokosumi/soko-bot";
import { Shuffle } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { DisclosureContent, DisclosureTrigger } from "@/components/disclosure";
import LiveBotAvatar from "@/components/soko-bot/live-bot-avatar.client";
import { Button } from "@/components/ui/button";
import { Collapsible } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  matchesMediaQuery,
  REDUCED_MOTION_MEDIA_QUERY,
} from "@/hooks/effects/use-media-query";
import { setSokoBotAvatarCodeAction } from "@/lib/actions/soko-bot/action";
import { stillSrc } from "@/lib/bot-avatar/load";
import { cn } from "@/lib/utils";

/** Core's answer when another bot already has the look. */
export const AVATAR_CODE_TAKEN = "avatar_code_taken";

type Palette = readonly AvatarColour[];

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="text-muted-foreground mb-2 text-xs font-medium">
        {label}
      </legend>
      {children}
    </fieldset>
  );
}

function Swatches({
  label,
  options,
  value,
  onChange,
  isDisabled,
}: {
  label: string;
  options: Palette;
  value: AvatarColour;
  onChange: (colour: AvatarColour) => void;
  isDisabled: (colour: AvatarColour) => boolean;
}) {
  const t = useTranslations("App.SokoBot.AvatarStudio.colours");
  return (
    <Group label={label}>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex flex-wrap gap-2"
      >
        {options.map((colour) => (
          <button
            key={colour}
            type="button"
            role="radio"
            aria-checked={colour === value}
            aria-label={t(colour)}
            title={t(colour)}
            disabled={isDisabled(colour)}
            onClick={() => onChange(colour)}
            style={{ backgroundColor: AVATAR_PALETTE[colour].hex }}
            className={cn(
              "border-border focus-visible:ring-ring size-8 rounded-full border outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:scale-[0.4] transition-transform",
              colour === value &&
                "ring-foreground ring-2 ring-offset-2 ring-offset-background",
            )}
          />
        ))}
      </div>
    </Group>
  );
}

function Options<T extends string>({
  label,
  options,
  value,
  onChange,
  labelOf,
  isDisabled = () => false,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  labelOf: (option: T) => string;
  isDisabled?: (option: T) => boolean;
}) {
  return (
    <Group label={label}>
      <ToggleGroup
        type="single"
        value={value}
        aria-label={label}
        // A single group deselects on a second press; a look always has a value.
        onValueChange={(next) => next && onChange(next as T)}
        className="flex-wrap"
      >
        {options.map((option) => (
          <ToggleGroupItem
            key={option}
            value={option}
            disabled={isDisabled(option)}
            className="flex-none"
          >
            {labelOf(option)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Group>
  );
}

/** A look that is valid for the animal: features it cannot draw fall back to the original. */
function withAnimal(look: AvatarLook, animal: AvatarAnimal): AvatarLook {
  const o = featureOptions(animal);
  return {
    ...look,
    animal,
    mouth: (o.mouth as readonly string[]).includes(look.mouth)
      ? look.mouth
      : "original",
    cheeks: (o.cheeks as readonly string[]).includes(look.cheeks)
      ? look.cheeks
      : "none",
  };
}

function resolveInitialAvatarCode(initialCode: string | null): string {
  const parsed = initialCode ? parseAvatarCode(initialCode) : null;
  return formatAvatarCode(parsed ?? randomAvatarLook());
}

/**
 * Builds a Soko Bot's look: a live preview in any state, and the pickers that make up its code.
 * Controlled by `code` (null while the caller has not picked a look yet); `onChange` fires on user edits.
 */
export function AvatarStudio({
  code: value,
  onChange,
  compact = false,
  onMoreDetailsChange,
}: {
  code: string | null;
  onChange: (code: string) => void;
  /** Setup: the preview, Shuffle and animals first, the rest under "More details", no preview states. */
  compact?: boolean;
  /** Setup: More details opened or closed, which scrolls the preview away or back. */
  onMoreDetailsChange?: (open: boolean) => void;
}) {
  const t = useTranslations("App.SokoBot.AvatarStudio");
  const look = useMemo(
    () => (value ? parseAvatarCode(value) : null) ?? originalAvatarLook("fox"),
    [value],
  );
  const [state, setState] = useState<AvatarState>("idle");
  // Setup pins Create to the foot, right under More details, so its fold opens
  // below the screen. Once the fold has its height, bring it up.
  const moreDetailsRef = useRef<HTMLButtonElement>(null);
  const showMoreDetails = (behavior: ScrollBehavior) =>
    moreDetailsRef.current?.scrollIntoView({ block: "start", behavior });
  const code = formatAvatarCode(look);
  const updateLook = (next: AvatarLook) => onChange(formatAvatarCode(next));
  const set = (patch: Partial<AvatarLook>) => updateLook({ ...look, ...patch });
  const features = featureOptions(look.animal);
  // Thumbnails wear the current colours and features, so each shows what choosing it gives.
  const thumbs = useMemo(
    () =>
      value
        ? AVATAR_ANIMALS.map((animal) => ({
            animal,
            src: stillSrc(withAnimal(look, animal)),
          }))
        : [],
    [look, value],
  );

  if (!value) return null;

  const details = (
    <>
      <Swatches
        label={t("background")}
        options={AVATAR_BACKGROUNDS}
        value={look.bg}
        onChange={(bg) => set({ bg: bg as AvatarLook["bg"] })}
        isDisabled={(c) => !isReadable(c, look.body, look.mark)}
      />
      <Swatches
        label={t("body")}
        options={AVATAR_COLOURS}
        value={look.body}
        onChange={(body) => set({ body })}
        isDisabled={(c) => !isReadable(look.bg, c, look.mark)}
      />
      <Swatches
        label={t("mark")}
        options={AVATAR_COLOURS}
        value={look.mark}
        onChange={(mark) => set({ mark })}
        isDisabled={(c) => !isReadable(look.bg, look.body, c)}
      />
      <Options
        label={t("corner")}
        options={AVATAR_CORNERS}
        value={look.corner}
        onChange={(corner) => set({ corner })}
        labelOf={(c) => t(c === "l" ? "cornerLeft" : "cornerRight")}
      />
      <Options
        label={t("size")}
        options={Object.keys(AVATAR_SIZES) as (keyof typeof AVATAR_SIZES)[]}
        value={look.size}
        onChange={(size) => set({ size })}
        labelOf={(s) => t(`sizes.${s}`)}
      />
      <Options
        label={t("eyes")}
        options={AVATAR_EYES}
        value={look.eyes}
        onChange={(eyes) => set({ eyes })}
        labelOf={(o) => t(`eyesOptions.${o}`)}
      />
      <Options
        label={t("mouth")}
        options={AVATAR_MOUTHS}
        value={look.mouth}
        onChange={(mouth) => set({ mouth })}
        labelOf={(o) => t(`mouths.${o}`)}
        isDisabled={(o) => !(features.mouth as readonly string[]).includes(o)}
      />
      <Options
        label={t("cheeks")}
        options={AVATAR_CHEEKS}
        value={look.cheeks}
        onChange={(cheeks) => set({ cheeks })}
        labelOf={(o) => t(`cheekOptions.${o}`)}
        isDisabled={(o) => !(features.cheeks as readonly string[]).includes(o)}
      />
      <Options
        label={t("hat")}
        options={AVATAR_HATS}
        value={look.hat}
        onChange={(hat) => set({ hat })}
        labelOf={(o) => t(`hats.${o}`)}
      />
    </>
  );

  return (
    // Laid out by its own width: setup draws it in a narrow frame on wide screens, the
    // Change-look dialog wide. Viewport breakpoints squeezed setup's animals to 8 px.
    <div className="@container min-w-0">
      {/* One shrinkable column: content wider than the frame wraps instead of widening it. */}
      <div className="grid min-w-0 grid-cols-1 gap-6 @2xl:grid-cols-[14rem_minmax(0,1fr)] @2xl:gap-8">
        <div
          className={cn(
            "flex items-center gap-4 @2xl:sticky @2xl:top-0 @2xl:self-start",
            // Setup: Shuffle beside the preview, so the animals come up sooner;
            // below it when the frame is too narrow for both.
            compact ? "flex-wrap justify-center" : "flex-col",
          )}
        >
          <LiveBotAvatar
            code={code}
            state={state}
            size={224}
            interactive
            alt={t("previewAlt")}
            className="ring-border size-40 ring-1 @2xl:size-56"
          />
          {/* Preview states test a look; a first-time visitor read "Error" as a fault. */}
          {compact ? null : (
            <ToggleGroup
              type="single"
              value={state}
              aria-label={t("stateLabel")}
              onValueChange={(next) => next && setState(next as AvatarState)}
              className="flex-wrap justify-center"
            >
              {[...AVATAR_STATES].reverse().map((s) => (
                <ToggleGroupItem
                  key={s}
                  value={s}
                  className="h-7 flex-none px-2 text-xs"
                >
                  {t(`states.${s}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
          <Button
            type="button"
            variant={compact ? "default" : "ghost"}
            onClick={() => updateLook(randomAvatarLook())}
          >
            <Shuffle aria-hidden />
            {t("shuffle")}
          </Button>
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <Group label={t("animal")}>
            <div className="grid grid-cols-4 gap-2 @md:grid-cols-8">
              {thumbs.map(({ animal, src }) => (
                <button
                  key={animal}
                  type="button"
                  aria-pressed={animal === look.animal}
                  aria-label={t(`animals.${animal}`)}
                  title={t(`animals.${animal}`)}
                  onClick={() => updateLook(withAnimal(look, animal))}
                  className={cn(
                    "focus-visible:ring-ring aspect-square overflow-hidden rounded-xl outline-none focus-visible:ring-2",
                    animal === look.animal &&
                      "ring-foreground ring-2 ring-offset-2 ring-offset-background",
                  )}
                >
                  <img src={src} alt="" className="size-full object-cover" />
                </button>
              ))}
            </div>
          </Group>
          {compact ? (
            <Collapsible
              onOpenChange={(open) => {
                onMoreDetailsChange?.(open);
                // Without motion there is no animation to wait for.
                if (open && matchesMediaQuery(REDUCED_MOTION_MEDIA_QUERY))
                  requestAnimationFrame(() => showMoreDetails("auto"));
              }}
            >
              <DisclosureTrigger
                ref={moreDetailsRef}
                className="w-full scroll-mt-4"
              >
                <span className="flex flex-col">
                  <span className="text-sm font-medium">
                    {t("moreDetails")}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t("moreDetailsHint")}
                  </span>
                </span>
              </DisclosureTrigger>
              {/* Room in the fold's own clip box for the 4 px selected and focus rings. */}
              <DisclosureContent
                className="-mx-2 px-2"
                onAnimationEnd={(event) => {
                  if (
                    event.target === event.currentTarget &&
                    event.currentTarget.dataset.state === "open"
                  )
                    showMoreDetails("smooth");
                }}
              >
                <div className="flex flex-col gap-5 pt-4 pb-2">{details}</div>
              </DisclosureContent>
            </Collapsible>
          ) : (
            details
          )}
        </div>
      </div>
    </div>
  );
}

/** Your bot's look in a dialog. Saves through Core; a look another bot has is refused inline. */
export function AvatarStudioDialog({
  open,
  onOpenChange,
  initialCode,
  botId,
  saveLook = (code) => setSokoBotAvatarCodeAction({ code, botId }),
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialCode: string | null;
  /** A shared bot's id; absent for your own. */
  botId?: string;
  /** Saves the look; the admin page passes its own action. Defaults to the owner's. */
  saveLook?: (code: string) => ReturnType<typeof setSokoBotAvatarCodeAction>;
  /** Extra work after a save; the page itself is already refreshed. */
  onSaved?: () => void | Promise<void>;
}) {
  const t = useTranslations("App.SokoBot");
  const [code, setCode] = useState<string>(() =>
    resolveInitialAvatarCode(initialCode),
  );
  const [taken, setTaken] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setCode(resolveInitialAvatarCode(initialCode));
      setTaken(false);
    }
  }
  const [isSaving, startSaving] = useTransition();

  const onChange = useCallback((next: string) => {
    setCode(next);
    setTaken(false);
  }, []);

  function save() {
    if (!code) return;
    startSaving(async () => {
      const result = await saveLook(code);
      if (!result.ok) {
        if (result.error.kind === AVATAR_CODE_TAKEN) setTaken(true);
        else toast.error(t("Avatar.saveError"));
        return;
      }
      toast.success(t("Avatar.saved"));
      onOpenChange(false);
      await onSaved?.();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("AvatarStudio.title")}</DialogTitle>
          <DialogDescription>{t("AvatarStudio.description")}</DialogDescription>
        </DialogHeader>
        <AvatarStudio code={code} onChange={onChange} />
        <DialogFooter className="items-center gap-3 sm:justify-between">
          <p role="status" className="text-destructive text-sm">
            {taken ? t("AvatarStudio.taken") : null}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              {t("AvatarStudio.cancel")}
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={isSaving}
              disabled={!code || code === initialCode}
              onClick={save}
            >
              {t("AvatarStudio.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

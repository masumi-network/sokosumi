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
  parseAvatarCode,
  randomAvatarLook,
} from "@sokosumi/soko-bot";
import { Shuffle } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import LiveBotAvatar from "@/components/soko-bot/live-bot-avatar.client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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

/**
 * Builds a Soko Bot's look: a live preview in any state, and the pickers that make up its code.
 * `onChange` gets the code on mount and after every change.
 */
export function AvatarStudio({
  initialCode,
  onChange,
}: {
  initialCode: string | null;
  onChange: (code: string) => void;
}) {
  const t = useTranslations("App.SokoBot.AvatarStudio");
  const [look, setLook] = useState<AvatarLook>(
    () =>
      (initialCode ? parseAvatarCode(initialCode) : null) ?? randomAvatarLook(),
  );
  const [state, setState] = useState<AvatarState>("idle");
  const code = formatAvatarCode(look);
  useEffect(() => onChange(code), [code, onChange]);
  const set = (patch: Partial<AvatarLook>) => setLook({ ...look, ...patch });
  const features = featureOptions(look.animal);
  // Thumbnails wear the current colours and features, so each shows what choosing it gives.
  const thumbs = useMemo(
    () =>
      AVATAR_ANIMALS.map((animal) => ({
        animal,
        src: stillSrc(withAnimal(look, animal)),
      })),
    [look],
  );

  return (
    <div className="grid min-w-0 gap-6 md:grid-cols-[14rem_minmax(0,1fr)] md:gap-8">
      <div className="flex flex-col items-center gap-4 md:sticky md:top-0 md:self-start">
        <LiveBotAvatar
          code={code}
          state={state}
          size={224}
          interactive
          alt={t("previewAlt")}
          className="ring-border size-40 ring-1 md:size-56"
        />
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
        <Button
          type="button"
          variant="ghost"
          onClick={() => setLook(randomAvatarLook())}
        >
          <Shuffle aria-hidden />
          {t("shuffle")}
        </Button>
      </div>
      <div className="flex min-w-0 flex-col gap-5">
        <Group label={t("animal")}>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
            {thumbs.map(({ animal, src }) => (
              <button
                key={animal}
                type="button"
                aria-pressed={animal === look.animal}
                aria-label={t(`animals.${animal}`)}
                title={t(`animals.${animal}`)}
                onClick={() => setLook(withAnimal(look, animal))}
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
          isDisabled={(o) =>
            !(features.cheeks as readonly string[]).includes(o)
          }
        />
        <Options
          label={t("hat")}
          options={AVATAR_HATS}
          value={look.hat}
          onChange={(hat) => set({ hat })}
          labelOf={(o) => t(`hats.${o}`)}
        />
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
  const [code, setCode] = useState(initialCode);
  const [taken, setTaken] = useState(false);
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
        <AvatarStudio initialCode={initialCode} onChange={onChange} />
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

"use client";

import { Palette } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type CSSProperties,
  type PointerEvent,
  useId,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { resolvedTaskTagColor, TagColorSwatch } from "./task-tag-colors";
import styles from "./task-tag-colors.module.css";
import {
  hexToWheelColor,
  normalizeTagHex,
  type WheelColor,
  wheelColorAtPoint,
  wheelColorPoint,
  wheelColorToHex,
} from "./task-tag-wheel-color";

const DEFAULT_WHEEL_COLOR: WheelColor = {
  hue: 0,
  saturation: 100,
  brightness: 100,
};

/** The named colors follow the current theme and may be CSS color mixes. */
function renderedHex(swatch: Element | null | undefined): string | null {
  if (!swatch) return null;
  const cssColor = getComputedStyle(swatch).backgroundColor;
  if (!cssColor || cssColor === "transparent") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = cssColor;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data;
  return alpha
    ? normalizeTagHex(
        [r, g, b]
          .map((channel) => channel.toString(16).padStart(2, "0"))
          .join(""),
      )
    : null;
}

export function TaskTagColorSelect({
  id,
  name,
  color,
  onChange,
  disabled,
}: {
  id?: string;
  name: string;
  color?: string | null;
  onChange: (color: string | null) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("App.Tasks.Tags");
  const [initial, setInitial] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const swatch = color ?? (id ? resolvedTaskTagColor(id) : null);
  const title = t("changeColor", { name });
  return (
    <Popover
      open={initial !== null}
      onOpenChange={(open) => {
        setInitial(
          open
            ? (normalizeTagHex(color) ??
                renderedHex(
                  trigger.current?.querySelector("[data-tag-color]"),
                ) ??
                wheelColorToHex(DEFAULT_WHEEL_COLOR))
            : null,
        );
      }}
    >
      <PopoverTrigger asChild>
        <Button
          ref={trigger}
          type="button"
          size="icon"
          variant="outline"
          aria-label={title}
          title={title}
          disabled={disabled}
          className="size-10 shrink-0 md:size-8"
        >
          {swatch ? (
            <TagColorSwatch color={swatch} />
          ) : (
            <Palette aria-hidden className="size-4" />
          )}
        </Button>
      </PopoverTrigger>
      {initial !== null && (
        <PopoverContent
          data-task-form-portal=""
          aria-label={title}
          className="w-60 max-w-[var(--radix-popover-content-available-width)]"
          align="end"
        >
          <ColorEditor
            initial={initial}
            onSelect={(next) => {
              setInitial(null);
              if (next !== (color ?? null)) onChange(next);
            }}
          />
        </PopoverContent>
      )}
    </Popover>
  );
}

function ColorEditor({
  initial,
  onSelect,
}: {
  initial: string;
  onSelect: (color: string | null) => void;
}) {
  const t = useTranslations("App.Tasks.Tags");
  const [wheel, setWheel] = useState(() => hexToWheelColor(initial));
  const [text, setText] = useState(initial);
  const fieldId = useId();
  const thumb = wheelColorPoint(wheel);
  const hex = normalizeTagHex(text);
  function changeWheel(next: WheelColor) {
    setWheel(next);
    setText(wheelColorToHex(next));
  }
  function pickAt(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const point = wheelColorAtPoint(
      (2 * (event.clientX - rect.left)) / rect.width - 1,
      (2 * (event.clientY - rect.top)) / rect.height - 1,
    );
    changeWheel({ ...wheel, ...point });
  }
  const wheelStyle: CSSProperties & { "--wheel-shade": number } = {
    "--wheel-shade": 1 - wheel.brightness / 100,
  };
  return (
    <div className="space-y-3">
      <div
        role="group"
        aria-label={t("colorWheel")}
        className={cn(
          styles.wheel,
          "focus-within:ring-ring relative mx-auto aspect-square w-full max-w-40 touch-none cursor-crosshair rounded-full focus-within:ring-2 focus-within:ring-offset-2",
        )}
        style={wheelStyle}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          pickAt(event);
        }}
        onPointerMove={(event) => {
          if (
            event.isPrimary &&
            event.currentTarget.hasPointerCapture(event.pointerId)
          )
            pickAt(event);
        }}
      >
        <span
          aria-hidden
          className="border-background ring-foreground pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ring-1"
          style={{
            left: `${(thumb.x + 1) * 50}%`,
            top: `${(thumb.y + 1) * 50}%`,
          }}
        />
        <input
          className="peer/hue sr-only"
          type="range"
          aria-label={t("colorHue")}
          aria-valuetext={`${Math.round(wheel.hue) % 360}°`}
          min={0}
          max={359}
          value={Math.round(wheel.hue) % 360}
          onChange={(event) =>
            changeWheel({ ...wheel, hue: event.currentTarget.valueAsNumber })
          }
        />
        <input
          className="peer/saturation sr-only"
          type="range"
          aria-label={t("colorSaturation")}
          aria-valuetext={`${Math.round(wheel.saturation)}%`}
          min={0}
          max={100}
          value={Math.round(wheel.saturation)}
          onChange={(event) =>
            changeWheel({
              ...wheel,
              saturation: event.currentTarget.valueAsNumber,
            })
          }
        />
        <span
          aria-hidden
          className="bg-popover text-foreground pointer-events-none absolute inset-x-0 bottom-2 mx-auto hidden w-fit rounded px-1 text-xs peer-focus-visible/hue:block"
        >
          {t("colorHue")} {Math.round(wheel.hue) % 360}°
        </span>
        <span
          aria-hidden
          className="bg-popover text-foreground pointer-events-none absolute inset-x-0 bottom-2 mx-auto hidden w-fit rounded px-1 text-xs peer-focus-visible/saturation:block"
        >
          {t("colorSaturation")} {Math.round(wheel.saturation)}%
        </span>
      </div>
      <label className="grid gap-1 text-xs">
        {t("colorBrightness")}
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(wheel.brightness)}
          aria-valuetext={`${Math.round(wheel.brightness)}%`}
          className="accent-foreground h-6 w-full"
          onChange={(event) =>
            changeWheel({
              ...wheel,
              brightness: event.currentTarget.valueAsNumber,
            })
          }
        />
      </label>
      <div className="grid gap-1">
        <label htmlFor={fieldId} className="text-xs">
          {t("colorHex")}
        </label>
        <div className="flex items-center gap-2">
          <TagColorSwatch color={wheelColorToHex(wheel)} />
          <Input
            id={fieldId}
            value={text}
            spellCheck={false}
            autoComplete="off"
            dir="ltr"
            maxLength={7}
            aria-invalid={!hex}
            className="min-w-0 flex-1 font-mono"
            onChange={(event) => {
              const value = event.currentTarget.value;
              setText(value);
              const valid = normalizeTagHex(value);
              if (valid) setWheel(hexToWheelColor(valid));
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                if (hex) onSelect(hex);
              }
            }}
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onSelect(null)}
        >
          {t("colors.auto")}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!hex}
          onClick={() => hex && onSelect(hex)}
        >
          {t("applyColor")}
        </Button>
      </div>
    </div>
  );
}

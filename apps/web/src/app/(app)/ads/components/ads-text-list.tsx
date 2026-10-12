"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ComponentProps, useId, useRef } from "react";
import { useFormContext } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface AdsCharCountProps {
  /** Its id, for the input it counts to name in `aria-describedby`. */
  id: string;
  /** As typed; the count is of the trimmed text, as the limit is. */
  text: string;
  max: number;
}

/** `12/30`: how much of a field's limit is used; red once over. */
export function AdsCharCount({ id, text, max }: AdsCharCountProps) {
  const length = text.trim().length;

  return (
    <span
      className={cn(
        "w-12 shrink-0 text-right text-xs tabular-nums",
        length > max ? "text-destructive" : "text-muted-foreground",
      )}
      id={id}
    >
      {length}/{max}
    </span>
  );
}

/** The lists of texts in the form, each an array of strings. */
type TextListName =
  | "headlines"
  | "descriptions"
  | "callouts"
  | "displayHeadlines"
  | "displayDescriptions";

/** The words a list uses; a Display ad's lists read like a Search ad's. */
const MESSAGES = {
  headlines: "headlines",
  descriptions: "descriptions",
  callouts: "callouts",
  displayHeadlines: "headlines",
  displayDescriptions: "descriptions",
} as const;

interface AdsCountedInputProps extends ComponentProps<typeof Input> {
  /** The `AdsCharCount` of this input, said after what the field already says. */
  counterId?: string;
}

/** An input inside a `FormControl` that its counter is read with. */
export function AdsCountedInput({
  counterId,
  "aria-describedby": describedBy,
  ...props
}: AdsCountedInputProps) {
  return (
    <Input
      aria-describedby={[describedBy, counterId].filter(Boolean).join(" ")}
      {...props}
    />
  );
}

interface AdsTextListProps {
  limits: { min: number; max: number; length: number };
  name: TextListName;
  /** The list is named by the disclosure around it. */
  hideLegend?: boolean;
}

/**
 * A list of single-line texts with a character counter on each: it starts
 * with the minimum Core needs, grows to the maximum and shrinks back to the
 * minimum.
 */
export function AdsTextList({ limits, name, hideLegend }: AdsTextListProps) {
  const t = useTranslations(`App.Ads.newCampaign.ad.${MESSAGES[name]}`);
  const form = useFormContext<Record<TextListName, string[]>>();
  const values = form.watch(name);
  const listId = useId();
  const counterId = (index: number) => `${listId}-${index}`;
  const addRef = useRef<HTMLButtonElement>(null);
  // Once the reader has submitted, a changed list is checked again at once.
  const revalidate = form.formState.isSubmitted;

  function handleAdd(): void {
    form.setValue(name, [...values, ""], { shouldDirty: true });
    // The new input mounts after this render.
    requestAnimationFrame(() => form.setFocus(`${name}.${values.length}`));
  }

  function handleRemove(index: number): void {
    form.setValue(
      name,
      values.filter((_, position) => position !== index),
      { shouldDirty: true, shouldValidate: revalidate },
    );
    if (values.length > 1) {
      form.setFocus(`${name}.${Math.max(0, index - 1)}`);
    } else {
      addRef.current?.focus();
    }
  }

  return (
    <fieldset className="grid gap-3">
      <legend className={cn("text-sm font-medium", hideLegend && "sr-only")}>
        {t("label")}
      </legend>
      <p className="text-muted-foreground text-sm">
        {t("help", { ...limits })}
      </p>
      {values.map((_, index) => (
        // The row is its position: fields are bound by `name.index`.
        <FormField
          control={form.control}
          key={index}
          name={`${name}.${index}`}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="sr-only">
                {t("item", { number: index + 1 })}
              </FormLabel>
              <div className="flex items-center gap-2">
                <FormControl>
                  <AdsCountedInput
                    autoComplete="off"
                    counterId={counterId(index)}
                    {...field}
                  />
                </FormControl>
                <AdsCharCount
                  id={counterId(index)}
                  max={limits.length}
                  text={field.value}
                />
                {values.length > limits.min ? (
                  <Button
                    aria-label={t("remove", { number: index + 1 })}
                    onClick={() => handleRemove(index)}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <X />
                  </Button>
                ) : null}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
      ))}
      {values.length < limits.max ? (
        <Button
          className="self-start"
          onClick={handleAdd}
          ref={addRef}
          size="sm"
          type="button"
          variant="ghost"
        >
          {t("add")}
        </Button>
      ) : null}
    </fieldset>
  );
}

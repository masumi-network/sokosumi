"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { useFormContext } from "react-hook-form";
import { toast } from "sonner";

import { ButtonLoadingBar } from "@/components/ui/button-loading-bar";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { loadNewsletterBrandFromDesignMd } from "@/lib/actions/newsletter/design-md";
import type { NewsletterSettingsValues } from "@/lib/schemas/newsletter";
import { cn } from "@/lib/utils";
import type { NewsletterDesignMdBrand } from "./newsletter-brand-from-design-md";
import { SELECT_TRIGGER_CLASS } from "./newsletter-design-fields";

/** A DESIGN.md the Brand fields can be filled from. */
export interface NewsletterDesignMdOption {
  source: "workspace" | "project";
  label: string;
}

/**
 * Fills the Brand fields from a DESIGN.md. It only sets what the document
 * names, as unsaved edits. The Select goes back to its placeholder afterwards,
 * so the same design can be applied again over later tweaks.
 */
export function NewsletterDesignMdPicker({
  projectId,
  options,
}: {
  projectId: string;
  options: NewsletterDesignMdOption[];
}) {
  const t = useTranslations("App.Projects.Newsletter.DesignPicker");
  const form = useFormContext<NewsletterSettingsValues>();
  const triggerId = useId();
  const [pending, setPending] = useState("");

  if (options.length === 0) return null;

  async function handleChoose(value: string) {
    const option = options.find(({ source }) => source === value);
    if (!option) return;
    setPending(option.source);
    try {
      const result = await loadNewsletterBrandFromDesignMd({
        projectId,
        source: option.source,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      const fields = Object.entries(result.value);
      if (fields.length === 0) {
        toast.error(t("empty"));
        return;
      }
      for (const [name, fieldValue] of fields) {
        form.setValue(name as keyof NewsletterDesignMdBrand, fieldValue, {
          shouldDirty: true,
          shouldValidate: true,
        });
      }
    } catch {
      toast.error(t("error"));
    } finally {
      setPending("");
    }
  }

  return (
    <div className="@container min-w-0">
      <div className="grid gap-3 @lg:grid-cols-2">
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={triggerId}>{t("label")}</Label>
          <Select
            value={pending}
            onValueChange={handleChoose}
            disabled={pending !== ""}
          >
            <SelectTrigger
              id={triggerId}
              aria-busy={pending !== ""}
              className={cn(SELECT_TRIGGER_CLASS, "relative overflow-hidden")}
            >
              <SelectValue placeholder={t("placeholder")} />
              {pending ? <ButtonLoadingBar label={t("label")} /> : null}
            </SelectTrigger>
            <SelectContent>
              {options.map(({ source, label }) => (
                <SelectItem key={source} value={source}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

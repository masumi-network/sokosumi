"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { AdMarketProfile } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveAdsMarketProfile } from "@/lib/actions/ads/action";
import {
  createMarketProfileSchema,
  MARKET_KEYWORD_LIMIT,
  type MarketOption,
} from "@/lib/ads/market";

import { AdsKeywordInput } from "./ads-keyword-input";

type SavedProfile = AdMarketProfile;

interface MarketProfileFormProps {
  projectId: string;
  /** Null until one is saved. */
  profile: SavedProfile | null;
  /** Named and sorted by the server, in the reader's language. */
  countries: MarketOption[];
  languages: MarketOption[];
}

interface AdsMarketProfileProps extends MarketProfileFormProps {
  /** "running shoes · Germany · German", made by the server. Null without a profile. */
  summary: string | null;
}

/**
 * The market profile. Without one the form is the page; with one it is a
 * quiet summary line and an "Edit market" dialog around the same form.
 */
export function AdsMarketProfile({
  summary,
  ...formProps
}: AdsMarketProfileProps) {
  const t = useTranslations("App.Ads.market");
  const [open, setOpen] = useState(false);

  if (!formProps.profile) {
    return (
      <div className="flex max-w-lg flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold">{t("setupTitle")}</h2>
          <p className="text-muted-foreground text-sm">{t("setupBody")}</p>
        </div>
        <MarketProfileForm {...formProps} />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <p className="text-muted-foreground min-w-0 text-sm">{summary}</p>
      <Button
        size="sm"
        type="button"
        variant="ghost"
        onClick={() => setOpen(true)}
      >
        {t("edit")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("edit")}</DialogTitle>
            <DialogDescription>{t("editBody")}</DialogDescription>
          </DialogHeader>
          <MarketProfileForm {...formProps} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Core's rules: 1 to 10 keywords, a supported country and a supported
 * language. The form mounts with its dialog, so it starts from what is saved.
 */
function MarketProfileForm({
  countries,
  languages,
  onDone,
  profile,
  projectId,
}: MarketProfileFormProps & { onDone?: () => void }) {
  const t = useTranslations("App.Ads.market.form");
  const [failed, setFailed] = useState(false);

  const schema = createMarketProfileSchema({
    keywordsRequired: t("errors.keywordsRequired"),
    keywordsTooMany: t("errors.keywordsTooMany", { max: MARKET_KEYWORD_LIMIT }),
    countryRequired: t("errors.countryRequired"),
    languageRequired: t("errors.languageRequired"),
  });

  const form = useForm<
    z.input<typeof schema>,
    unknown,
    z.output<typeof schema>
  >({
    resolver: zodResolver(schema),
    defaultValues: {
      keywords: profile?.keywords ?? [],
      countryCode: profile?.countryCode,
      languageCode: profile?.languageCode,
    },
  });

  async function handleSubmit(values: z.output<typeof schema>): Promise<void> {
    setFailed(false);
    try {
      const result = await saveAdsMarketProfile({ projectId, ...values });
      if (!result.ok) {
        setFailed(true);
        return;
      }
      toast.success(t("success"));
      onDone?.();
    } catch {
      setFailed(true);
    }
  }

  const submit = (
    <Button disabled={form.formState.isSubmitting} type="submit">
      {form.formState.isSubmitting ? t("saving") : t("submit")}
    </Button>
  );

  return (
    <Form {...form}>
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(event) => void form.handleSubmit(handleSubmit)(event)}
      >
        <FormField
          control={form.control}
          name="keywords"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("keywords")}</FormLabel>
              <FormControl>
                <AdsKeywordInput
                  value={field.value}
                  onChange={field.onChange}
                />
              </FormControl>
              <FormDescription>
                {t("keywordsHint", { max: MARKET_KEYWORD_LIMIT })}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="countryCode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("country")}</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value ?? ""}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("countryPlaceholder")} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {countries.map(({ code, name }) => (
                      <SelectItem key={code} value={code}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="languageCode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("language")}</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value ?? ""}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("languagePlaceholder")} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {languages.map(({ code, name }) => (
                      <SelectItem key={code} value={code}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        {failed ? (
          <p className="text-destructive text-sm" role="alert">
            {t("errors.failed")}
          </p>
        ) : null}
        {onDone ? (
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onDone}>
              {t("cancel")}
            </Button>
            {submit}
          </DialogFooter>
        ) : (
          <div>{submit}</div>
        )}
      </form>
    </Form>
  );
}

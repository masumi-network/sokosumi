"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { ProjectAdProvider } from "@sokosumi/core-client";
import Link from "next/link";
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createAdCampaign } from "@/lib/actions/ads/action";
import { AD_CAMPAIGN_OBJECTIVES } from "@/lib/ads/campaign";

import { useAdsBudget } from "./ads-budget";

interface AdsNewCampaignProps {
  accountId: string;
  currency: string;
  projectId: string;
  provider: ProjectAdProvider;
}

interface NewCampaignValues {
  name: string;
  dailyBudget: string;
  objective: string;
}

/**
 * "New campaign": a button and the dialog it opens. Core creates the campaign
 * paused; the action revalidates the page, so the list refetches and nothing
 * updates optimistically.
 */
export function AdsNewCampaign(props: AdsNewCampaignProps) {
  const t = useTranslations("App.Ads.campaigns.newCampaign");
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" type="button">
        {t("title")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("note")}</DialogDescription>
          </DialogHeader>
          <NewCampaignForm {...props} onClose={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The rules are Core's: a name of 1 to 255 characters, a budget above 0
 * within the currency's precision and, for Meta only, one objective. The form
 * mounts with the dialog, so it starts empty each time.
 */
function NewCampaignForm({
  accountId,
  currency,
  onClose,
  projectId,
  provider,
}: AdsNewCampaignProps & { onClose: () => void }) {
  const t = useTranslations("App.Ads.campaigns.newCampaign");
  const tCampaigns = useTranslations("App.Ads.campaigns");
  const budget = useAdsBudget(currency);
  const needsObjective = provider === "meta_ads";
  const [refusal, setRefusal] = useState<"reconnect" | "failed" | null>(null);

  const form = useForm<NewCampaignValues>({
    resolver: zodResolver(
      z.object({
        name: z
          .string()
          .trim()
          .min(1, t("errors.nameRequired"))
          .max(255, t("errors.nameTooLong")),
        dailyBudget: budget.schema,
        objective: needsObjective
          ? z.string().min(1, t("errors.objectiveRequired"))
          : z.string(),
      }),
    ),
    defaultValues: { name: "", dailyBudget: "", objective: "" },
  });

  async function handleSubmit(values: NewCampaignValues): Promise<void> {
    setRefusal(null);
    const objective = AD_CAMPAIGN_OBJECTIVES.find(
      (candidate) => candidate === values.objective,
    );
    try {
      const result = await createAdCampaign({
        projectId,
        accountId,
        name: values.name,
        dailyBudget: Number(values.dailyBudget),
        objective,
      });
      if (result.ok) {
        toast.success(t("success"));
        onClose();
      } else if (result.error.status === 422) {
        form.setError("dailyBudget", { message: budget.precisionMessage });
      } else {
        setRefusal(result.error.status === 409 ? "reconnect" : "failed");
      }
    } catch {
      setRefusal("failed");
    }
  }

  const accountsParams = new URLSearchParams({ projectId, tab: "accounts" });

  return (
    <Form {...form}>
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(event) => void form.handleSubmit(handleSubmit)(event)}
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("name")}</FormLabel>
              <FormControl>
                <Input autoComplete="off" maxLength={255} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="dailyBudget"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{budget.label}</FormLabel>
              <FormControl>
                <Input
                  inputMode="decimal"
                  min={0}
                  step={budget.step}
                  type="number"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {needsObjective ? (
          <FormField
            control={form.control}
            name="objective"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("objective")}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("objectivePlaceholder")} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {AD_CAMPAIGN_OBJECTIVES.map((candidate) => (
                      <SelectItem key={candidate} value={candidate}>
                        {t(`objectives.${candidate}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}
        {refusal ? (
          <p className="text-destructive text-sm" role="alert">
            {refusal === "reconnect" ? (
              <>
                {tCampaigns("errors.notActive.title")}{" "}
                <Link
                  className="underline"
                  href={`/ads?${accountsParams.toString()}`}
                >
                  {tCampaigns("errors.notActive.action")}
                </Link>
              </>
            ) : (
              t("errors.failed")
            )}
          </p>
        ) : null}
        <DialogFooter>
          <Button onClick={onClose} type="button" variant="ghost">
            {tCampaigns("cancel")}
          </Button>
          <Button disabled={form.formState.isSubmitting} type="submit">
            {form.formState.isSubmitting ? t("saving") : t("submit")}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

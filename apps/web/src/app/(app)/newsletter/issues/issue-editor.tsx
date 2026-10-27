"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  type NewsletterIssue,
  type NewsletterIssueAnalytics,
  NewsletterIssueStatus,
} from "@sokosumi/core-client";
import type { NewsletterBlock } from "@sokosumi/utils";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { saveNewsletterIssue } from "@/lib/actions/newsletter/issues";
import {
  type NewsletterIssueValues,
  newsletterIssueInputSchema,
} from "@/lib/schemas/newsletter-issues";
import { IssueAnalyticsSummary } from "../analytics/issue-analytics-summary";
import { newsletterHref } from "../newsletter-tabs";
import { IssueActions } from "./issue-actions";
import { IssueBlockFields } from "./issue-block-fields";
import { NewsletterIssuePreview } from "./issue-preview";

const BLOCK_TYPES = ["heading", "text", "image", "button", "divider"] as const;

export function NewsletterIssueEditor({
  projectId,
  issue,
  activeSubscribers,
  newsletterSlug,
  analytics,
}: {
  projectId: string;
  issue: NewsletterIssue;
  activeSubscribers: number;
  newsletterSlug: string;
  analytics?: NewsletterIssueAnalytics | null;
}) {
  const t = useTranslations("App.Projects.Newsletter.Issues");
  const [currentIssue, setCurrentIssue] = useState(issue);
  const [lifecyclePending, setLifecyclePending] = useState(false);
  const { revision, status } = currentIssue;
  const editable =
    status === NewsletterIssueStatus.DRAFT ||
    status === NewsletterIssueStatus.NEEDS_APPROVAL;
  const form = useForm<NewsletterIssueValues>({
    resolver: zodResolver(newsletterIssueInputSchema(t), {
      error: () => t("Validation.content"),
    }),
    defaultValues: {
      subject: issue.subject,
      previewText: issue.previewText ?? "",
      template: issue.template,
      content: issue.content,
    },
  });
  const blocks = useFieldArray({ control: form.control, name: "content" });
  const [subject, previewText, template, content] = useWatch({
    control: form.control,
    name: ["subject", "previewText", "template", "content"],
  });
  const { isDirty, isSubmitting, errors } = form.formState;

  useEffect(() => {
    if (!isDirty) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  async function handleSave(values: NewsletterIssueValues) {
    form.clearErrors("root");
    try {
      const result = await saveNewsletterIssue({
        projectId,
        issueId: issue.id,
        revision,
        values,
      });
      if (!result.ok) {
        form.setError("root", { message: result.error.message });
        Object.entries(result.error.fieldErrors ?? {}).forEach(
          ([name, messages], index) => {
            form.setError(
              name as keyof NewsletterIssueValues,
              { message: messages?.[0] },
              { shouldFocus: index === 0 },
            );
          },
        );
        return;
      }
      setCurrentIssue(result.value);
      form.reset({
        subject: result.value.subject,
        previewText: result.value.previewText ?? "",
        template: result.value.template,
        content: result.value.content,
      });
    } catch {
      form.setError("root", { message: t("saveError") });
    }
  }

  function handleAdd(type: NewsletterBlock["type"]) {
    switch (type) {
      case "heading":
        blocks.append({ type, text: "", level: 2 });
        break;
      case "text":
        blocks.append({ type, text: "" });
        break;
      case "image":
        blocks.append({ type, url: "", alt: "" });
        break;
      case "button":
        blocks.append({ type, label: t("Templates.button"), url: "" });
        break;
      case "divider":
        blocks.append({ type });
        break;
    }
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="outline">
          <Link href={newsletterHref("/newsletter/issues", projectId)}>
            {t("back")}
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          {status === NewsletterIssueStatus.SENT ? (
            <Button asChild variant="outline">
              <Link
                href={`/n/${encodeURIComponent(newsletterSlug)}/p/${encodeURIComponent(currentIssue.publicSlug)}`}
              >
                {t("viewOnWeb")}
              </Link>
            </Button>
          ) : null}
          <Badge variant="secondary">
            {currentIssue.approvedAt && status === "NEEDS_APPROVAL"
              ? t("Lifecycle.approved")
              : t(`statuses.${status}`)}
          </Badge>
        </div>
      </div>
      <IssueActions
        issue={currentIssue}
        projectId={projectId}
        activeSubscribers={activeSubscribers}
        disabled={isDirty || isSubmitting}
        onChanged={setCurrentIssue}
        onBusyChange={setLifecyclePending}
      />
      {isDirty ? (
        <p className="text-muted-foreground text-sm">
          {t("Lifecycle.saveFirst")}
        </p>
      ) : null}
      {!editable ? (
        <p className="text-muted-foreground text-sm" role="note">
          {t("readOnly")}
        </p>
      ) : null}
      {status === NewsletterIssueStatus.SENT && analytics ? (
        <IssueAnalyticsSummary analytics={analytics} />
      ) : null}
      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-2">
        <Form {...form}>
          <form
            noValidate
            onSubmit={form.handleSubmit(handleSave)}
            className="min-w-0 space-y-6"
          >
            <fieldset
              disabled={!editable || isSubmitting || lifecyclePending}
              className="min-w-0 space-y-6"
            >
              <FormField
                control={form.control}
                name="subject"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("subject")}</FormLabel>
                    <FormControl>
                      <Input {...field} maxLength={200} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="previewText"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("previewText")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value ?? ""}
                        maxLength={500}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <section className="space-y-4" aria-label={t("blocks")}>
                <h3 className="text-base font-semibold">{t("blocks")}</h3>
                {errors.content?.message || errors.content?.root?.message ? (
                  <p
                    role="alert"
                    className="text-semantic-destructive-label text-sm"
                  >
                    {errors.content.message ?? errors.content.root?.message}
                  </p>
                ) : null}
                {!blocks.fields.length ? (
                  <p className="text-muted-foreground text-sm">
                    {t("emptyBlocks")}
                  </p>
                ) : null}
                <ol className="space-y-4">
                  {blocks.fields.map((block, index) => (
                    <li
                      key={block.id}
                      className="min-w-0 space-y-4 rounded-xl border p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 className="text-sm font-medium">
                          {t("blockNumber", {
                            number: index + 1,
                            type: t(`blockTypes.${block.type}`),
                          })}
                        </h4>
                        {editable ? (
                          <div className="flex gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-10 md:size-8"
                              disabled={index === 0}
                              aria-label={t("moveUp", { number: index + 1 })}
                              onClick={() => blocks.move(index, index - 1)}
                            >
                              <ArrowUp />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-10 md:size-8"
                              disabled={index === blocks.fields.length - 1}
                              aria-label={t("moveDown", { number: index + 1 })}
                              onClick={() => blocks.move(index, index + 1)}
                            >
                              <ArrowDown />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-10 md:size-8"
                              aria-label={t("removeBlock", {
                                number: index + 1,
                              })}
                              onClick={() => blocks.remove(index)}
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        ) : null}
                      </div>
                      <IssueBlockFields
                        index={index}
                        block={block}
                        disabled={!editable || isSubmitting || lifecyclePending}
                      />
                    </li>
                  ))}
                </ol>
                {editable ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      asChild
                      disabled={isSubmitting || blocks.fields.length >= 200}
                    >
                      <Button type="button" variant="outline">
                        <Plus />
                        {t("addBlock")}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {BLOCK_TYPES.map((type) => (
                        <DropdownMenuItem
                          key={type}
                          onSelect={() => handleAdd(type)}
                        >
                          {t(`blockTypes.${type}`)}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </section>
            </fieldset>
            {errors.root?.message ? (
              <p
                role="alert"
                className="text-semantic-destructive-label text-sm"
              >
                {errors.root.message}
              </p>
            ) : null}
            {editable ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p role="status" className="text-muted-foreground text-sm">
                  {isDirty ? t("unsaved") : t("saved")}
                </p>
                <Button
                  type="submit"
                  variant="primary"
                  loading={isSubmitting}
                  disabled={lifecyclePending}
                >
                  {t("save")}
                </Button>
              </div>
            ) : null}
          </form>
        </Form>
        <NewsletterIssuePreview
          projectId={projectId}
          values={{ subject, previewText, template, content }}
        />
      </div>
    </div>
  );
}

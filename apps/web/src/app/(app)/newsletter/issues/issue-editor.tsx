"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  type NewsletterIssue,
  type NewsletterIssueAnalytics,
  NewsletterIssueStatus,
  type NewsletterSendingDomainState,
} from "@sokosumi/core-client";
import type { NewsletterBlock } from "@sokosumi/utils";
import { ArrowDown, ArrowUp, Plus, Trash2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { IssueAnalyticsSummary } from "@/app/newsletter/analytics/issue-analytics-summary";
import { newsletterHref } from "@/app/newsletter/newsletter-tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { Input } from "@/components/ui/input";
import { saveNewsletterIssue } from "@/lib/actions/newsletter/issues";
import {
  type NewsletterIssueValues,
  newsletterIssueInputSchema,
} from "@/lib/schemas/newsletter-issues";
import { cn } from "@/lib/utils";
import { DraftIssueButton } from "./draft-issue-dialog";
import { IssueActions } from "./issue-actions";
import { IssueBlockFields } from "./issue-block-fields";
import { getIssueStage } from "./issue-flow";
import { NewsletterIssuePreview } from "./issue-preview";

const BLOCK_TYPES = ["heading", "text", "image", "button", "divider"] as const;

export function NewsletterIssueEditor({
  projectId,
  issue,
  activeSubscribers,
  senderName,
  sendingDomain,
  newsletterSlug,
  analytics,
  draftedBySokoBot = false,
}: {
  projectId: string;
  issue: NewsletterIssue;
  activeSubscribers: number;
  senderName: string;
  sendingDomain: NewsletterSendingDomainState;
  newsletterSlug: string;
  analytics?: NewsletterIssueAnalytics | null;
  draftedBySokoBot?: boolean;
}) {
  const t = useTranslations("App.Projects.Newsletter.Issues");
  const flow = useTranslations("App.Projects.Newsletter.Issues.Flow");
  const [currentIssue, setCurrentIssue] = useState(issue);
  const [lifecyclePending, setLifecyclePending] = useState(false);
  const [removedBlocks, setRemovedBlocks] = useState<
    { block: NewsletterBlock; index: number }[]
  >([]);
  const undoButton = useRef<HTMLButtonElement>(null);
  const blockList = useRef<HTMLOListElement>(null);
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
  const stage = getIssueStage(currentIssue, isDirty);

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

  function handleRemove(index: number) {
    const block = structuredClone(form.getValues(`content.${index}`));
    setRemovedBlocks((removed) => [...removed, { block, index }]);
    blocks.remove(index);
    requestAnimationFrame(() => undoButton.current?.focus());
  }

  function handleUndo() {
    const removed = removedBlocks.at(-1);
    if (!removed) return;
    const index = Math.min(removed.index, blocks.fields.length);
    blocks.insert(index, removed.block);
    setRemovedBlocks((removed) => removed.slice(0, -1));
    if (removed.block.type === "divider") {
      requestAnimationFrame(() =>
        blockList.current?.children[index]
          ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
          ?.focus(),
      );
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
      {draftedBySokoBot && status === NewsletterIssueStatus.DRAFT ? (
        <Alert role="note">
          <AlertDescription>{t("Ai.notice")}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="outline">
          <Link href={newsletterHref("/newsletter/issues", projectId)}>
            {t("back")}
          </Link>
        </Button>
        {status === NewsletterIssueStatus.SENT ? (
          <Button asChild variant="outline">
            <Link
              href={`/n/${encodeURIComponent(newsletterSlug)}/p/${encodeURIComponent(currentIssue.publicSlug)}`}
            >
              {t("viewOnWeb")}
            </Link>
          </Button>
        ) : null}
      </div>
      <IssueActions
        issue={currentIssue}
        projectId={projectId}
        activeSubscribers={activeSubscribers}
        senderName={senderName}
        sendingDomain={sendingDomain}
        disabled={isDirty || isSubmitting}
        unsaved={isDirty}
        onChanged={setCurrentIssue}
        onBusyChange={setLifecyclePending}
      />
      {status === NewsletterIssueStatus.SENT && analytics ? (
        <IssueAnalyticsSummary analytics={analytics} />
      ) : null}
      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-2">
        <div className={cn(HOLDER_CLASS, "min-w-0 p-3")}>
          <Form {...form}>
            <form
              noValidate
              onSubmit={form.handleSubmit(handleSave)}
              className="min-w-0 space-y-4"
            >
              {/* Save sits with the writing it saves, in the flow, so it never
                  covers a field the way a sticky bar did. */}
              <div className="flex flex-wrap items-center justify-between gap-3 px-1">
                <div className="min-w-0 space-y-0.5">
                  <h2 className="text-base font-semibold">
                    {flow("steps.write")}
                  </h2>
                  {editable ? (
                    <p
                      role="status"
                      className="text-muted-foreground flex flex-wrap gap-x-2 text-sm"
                    >
                      <span>
                        {isSubmitting
                          ? t("saving")
                          : isDirty
                            ? t("unsaved")
                            : t("saved")}
                      </span>
                      {removedBlocks.length ? (
                        <span>
                          {t("removedBlocks", { count: removedBlocks.length })}
                        </span>
                      ) : null}
                    </p>
                  ) : (
                    <p className="text-muted-foreground text-sm" role="note">
                      {t("readOnly")}
                    </p>
                  )}
                </div>
                {editable ? (
                  <div className="flex flex-wrap gap-2">
                    {!blocks.fields.length ? (
                      <DraftIssueButton
                        projectId={projectId}
                        template={template}
                      />
                    ) : null}
                    {removedBlocks.length ? (
                      <Button
                        ref={undoButton}
                        type="button"
                        variant="outline"
                        onClick={handleUndo}
                        disabled={
                          isSubmitting ||
                          lifecyclePending ||
                          blocks.fields.length >= 200
                        }
                      >
                        <Undo2 />
                        {t("undo")}
                      </Button>
                    ) : null}
                    <Button
                      type="submit"
                      variant={stage === "write" ? "primary" : "outline"}
                      loading={isSubmitting}
                      disabled={lifecyclePending}
                    >
                      {t("save")}
                    </Button>
                  </div>
                ) : null}
                {editable &&
                removedBlocks.length &&
                blocks.fields.length >= 200 ? (
                  <p className="text-muted-foreground w-full text-sm">
                    {t("undoLimit")}
                  </p>
                ) : null}
              </div>
              {errors.root?.message ? (
                <p role="alert" className="text-foreground px-1 text-sm">
                  {errors.root.message}
                </p>
              ) : null}
              <fieldset
                disabled={!editable || isSubmitting || lifecyclePending}
                className="min-w-0 space-y-4"
              >
                <section
                  aria-label={t("details")}
                  className={cn(HOLDER_ITEM_CLASS, "min-w-0 space-y-4 p-4")}
                >
                  <h3 className="text-base font-semibold">{t("details")}</h3>
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
                </section>
                <section className="space-y-4" aria-label={t("blocks")}>
                  <h3 className="px-1 text-base font-semibold">
                    {t("blocks")}
                  </h3>
                  {errors.content?.message || errors.content?.root?.message ? (
                    <p role="alert" className="text-foreground text-sm">
                      {errors.content.message ?? errors.content.root?.message}
                    </p>
                  ) : null}
                  {!blocks.fields.length ? (
                    <p
                      className={cn(
                        HOLDER_ITEM_CLASS,
                        "text-muted-foreground p-4 text-sm",
                      )}
                    >
                      {t("emptyBlocks")}
                    </p>
                  ) : null}
                  <ol ref={blockList} className="space-y-4">
                    {blocks.fields.map((block, index) => (
                      <li
                        key={block.id}
                        className={cn(
                          HOLDER_ITEM_CLASS,
                          "min-w-0 space-y-4 p-4",
                        )}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h4 className="min-w-0 text-sm font-medium wrap-anywhere">
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
                                aria-label={t("moveDown", {
                                  number: index + 1,
                                })}
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
                                onClick={() => handleRemove(index)}
                              >
                                <Trash2 />
                              </Button>
                            </div>
                          ) : null}
                        </div>
                        <IssueBlockFields
                          index={index}
                          block={block}
                          disabled={
                            !editable || isSubmitting || lifecyclePending
                          }
                        />
                      </li>
                    ))}
                  </ol>
                  {editable ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        asChild
                        disabled={
                          isSubmitting ||
                          lifecyclePending ||
                          blocks.fields.length >= 200
                        }
                      >
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full"
                        >
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
            </form>
          </Form>
        </div>
        {/* Under Review the preview is the thing to read, so on narrow
            screens it comes first. */}
        <div
          className={cn("min-w-0", stage === "review" && "max-xl:order-first")}
        >
          <NewsletterIssuePreview
            projectId={projectId}
            values={{ subject, previewText, template, content }}
          />
        </div>
      </div>
    </div>
  );
}

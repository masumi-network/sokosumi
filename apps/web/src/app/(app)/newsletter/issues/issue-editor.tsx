"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  type Newsletter,
  type NewsletterIssue,
  type NewsletterIssueAnalytics,
  NewsletterIssueStatus,
  type NewsletterSendingDomainState,
} from "@sokosumi/core-client";
import type { NewsletterBlock } from "@sokosumi/utils";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  LayoutList,
  Palette,
  Trash2,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { IssueAnalyticsSummary } from "@/app/newsletter/analytics/issue-analytics-summary";
import { newsletterDesignDefaults } from "@/app/newsletter/newsletter-design-fields";
import { NewsletterDesignPanel } from "@/app/newsletter/newsletter-design-panel";
import { newsletterHref } from "@/app/newsletter/newsletter-tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { saveNewsletterIssue } from "@/lib/actions/newsletter/issues";
import {
  type NewsletterSettingsValues,
  newsletterBrandForPreview,
  newsletterSettingsSchema,
} from "@/lib/schemas/newsletter";
import {
  type NewsletterIssueValues,
  newsletterIssueInputSchema,
} from "@/lib/schemas/newsletter-issues";
import { cn } from "@/lib/utils";
import { DraftIssueButton } from "./draft-issue-dialog";
import { IssueActions } from "./issue-actions";
import { IssueBlockFields } from "./issue-block-fields";
import { BlockIcon, IssueBlockLibrary, newBlock } from "./issue-block-library";
import {
  IssueDeliveryOutcome,
  IssueStatusBadge,
} from "./issue-delivery-status";
import { NewsletterIssuePreview } from "./issue-preview";

function newsletterSettingsValues(
  newsletter: Newsletter,
): NewsletterSettingsValues {
  return {
    name: newsletter.name,
    senderName: newsletter.senderName,
    replyTo: newsletter.replyTo,
    welcomeEmailEnabled: newsletter.welcomeEmailEnabled,
    welcomeSubject: newsletter.welcomeSubject ?? "",
    welcomeBody: newsletter.welcomeBody ?? "",
    ...newsletterDesignDefaults(newsletter),
  };
}

export function NewsletterIssueEditor({
  projectId,
  issue,
  activeSubscribers,
  newsletter,
  sendingDomain,
  analytics,
  draftedBySokoBot = false,
}: {
  projectId: string;
  issue: NewsletterIssue;
  activeSubscribers: number;
  newsletter: Newsletter;
  sendingDomain: NewsletterSendingDomainState;
  analytics?: NewsletterIssueAnalytics | null;
  draftedBySokoBot?: boolean;
}) {
  const t = useTranslations("App.Projects.Newsletter.Issues");
  const validationT = useTranslations("App.Projects.Newsletter.Validation");
  const [tab, setTab] = useState("content");
  const [currentIssue, setCurrentIssue] = useState(issue);
  const [lifecyclePending, setLifecyclePending] = useState(false);
  const [removedBlocks, setRemovedBlocks] = useState<
    { block: NewsletterBlock; index: number }[]
  >([]);
  const formId = useId();
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
  const designForm = useForm<NewsletterSettingsValues>({
    resolver: zodResolver(newsletterSettingsSchema(validationT)),
    defaultValues: newsletterSettingsValues(newsletter),
  });
  const design = useWatch({ control: designForm.control });
  const designDirty = designForm.formState.isDirty;
  const unsaved = isDirty || designDirty;

  useEffect(() => {
    if (!unsaved) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [unsaved]);

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
    blocks.append(newBlock(type, t("Templates.button")));
  }

  function handleDuplicate(index: number) {
    blocks.insert(
      index + 1,
      structuredClone(form.getValues(`content.${index}`)),
    );
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
        <div className="flex flex-wrap items-center gap-3">
          {editable && !blocks.fields.length ? (
            <DraftIssueButton projectId={projectId} template={template} />
          ) : null}
          {status === NewsletterIssueStatus.SENT ? (
            <Button asChild variant="outline">
              <Link
                href={`/n/${encodeURIComponent(newsletter.publicSlug)}/p/${encodeURIComponent(currentIssue.publicSlug)}`}
              >
                {t("viewOnWeb")}
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
      {status === NewsletterIssueStatus.SENT && analytics ? (
        <IssueAnalyticsSummary analytics={analytics} />
      ) : null}
      {/* Editor first. The Send panel sits right of the editor and preview (sticky), and on
          phones between them, so Save stays right after the last block. */}
      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(18rem,22rem)]">
        <div
          className={cn(
            HOLDER_CLASS,
            "min-w-0 p-3 lg:col-start-1 lg:row-start-1",
          )}
        >
          <Tabs value={tab} onValueChange={setTab} className="min-w-0 gap-3">
            <TabsList aria-label={t("Studio.label")} className="w-full">
              <TabsTrigger value="content">
                <LayoutList />
                {t("Studio.content")}
              </TabsTrigger>
              <TabsTrigger value="design">
                <Palette />
                {t("Studio.design")}
                {designDirty ? (
                  <span
                    aria-hidden
                    className="bg-semantic-warning size-2 rounded-full"
                  />
                ) : null}
              </TabsTrigger>
            </TabsList>
            {/* Both stay mounted, so switching tabs keeps unsaved edits and the field arrays. */}
            <TabsContent
              value="content"
              forceMount
              hidden={tab !== "content"}
              className="min-w-0"
            >
              <Form {...form}>
                <form
                  id={formId}
                  noValidate
                  onSubmit={form.handleSubmit(handleSave)}
                  className="min-w-0 space-y-4"
                >
                  <fieldset
                    disabled={!editable || isSubmitting || lifecyclePending}
                    className="min-w-0 space-y-4"
                  >
                    <section
                      aria-label={t("details")}
                      className={cn(HOLDER_ITEM_CLASS, "min-w-0 space-y-4 p-4")}
                    >
                      <h3 className="text-base font-semibold">
                        {t("details")}
                      </h3>
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
                      {errors.content?.message ||
                      errors.content?.root?.message ? (
                        <p role="alert" className="text-foreground text-sm">
                          {errors.content.message ??
                            errors.content.root?.message}
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
                      <ol
                        ref={blockList}
                        aria-label={t("blocks")}
                        className="space-y-4"
                      >
                        {blocks.fields.map((block, index) => (
                          <li
                            key={block.id}
                            className={cn(
                              HOLDER_ITEM_CLASS,
                              "@container min-w-0 space-y-4 p-4",
                            )}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <h4 className="flex min-w-0 items-center gap-2 text-sm font-medium wrap-anywhere">
                                <BlockIcon type={block.type} />
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
                                    aria-label={t("moveUp", {
                                      number: index + 1,
                                    })}
                                    onClick={() =>
                                      blocks.move(index, index - 1)
                                    }
                                  >
                                    <ArrowUp />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-10 md:size-8"
                                    disabled={
                                      index === blocks.fields.length - 1
                                    }
                                    aria-label={t("moveDown", {
                                      number: index + 1,
                                    })}
                                    onClick={() =>
                                      blocks.move(index, index + 1)
                                    }
                                  >
                                    <ArrowDown />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-10 md:size-8"
                                    disabled={blocks.fields.length >= 200}
                                    aria-label={t("duplicateBlock", {
                                      number: index + 1,
                                    })}
                                    onClick={() => handleDuplicate(index)}
                                  >
                                    <Copy />
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
                        <IssueBlockLibrary
                          disabled={
                            isSubmitting ||
                            lifecyclePending ||
                            blocks.fields.length >= 200
                          }
                          onAdd={handleAdd}
                        />
                      ) : null}
                    </section>
                  </fieldset>
                </form>
              </Form>
            </TabsContent>
            <TabsContent
              value="design"
              forceMount
              hidden={tab !== "design"}
              className="min-w-0"
            >
              <NewsletterDesignPanel form={designForm} projectId={projectId} />
            </TabsContent>
          </Tabs>
        </div>
        <aside
          aria-label={t("sendPanel")}
          className={cn(
            HOLDER_CLASS,
            "min-w-0 space-y-2 lg:sticky lg:top-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:overscroll-contain 2xl:col-start-3 2xl:row-span-1",
          )}
        >
          <div className={cn(HOLDER_ITEM_CLASS, "min-w-0 space-y-3 p-4")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold">{t("sendPanel")}</h3>
              <IssueStatusBadge issue={currentIssue} />
            </div>
            {editable ? (
              <div className="space-y-3">
                <div
                  role="status"
                  className="text-muted-foreground min-w-0 space-y-1 text-sm"
                >
                  <p className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        isDirty || isSubmitting
                          ? "bg-semantic-warning"
                          : "bg-semantic-success",
                      )}
                    />
                    {isSubmitting
                      ? t("saving")
                      : isDirty
                        ? t("unsaved")
                        : t("saved")}
                  </p>
                  {removedBlocks.length ? (
                    <p>{t("removedBlocks", { count: removedBlocks.length })}</p>
                  ) : null}
                  {designDirty ? <p>{t("Studio.designUnsaved")}</p> : null}
                </div>
                <div className="flex flex-wrap gap-2 [&>button]:min-w-0 [&>button]:flex-1">
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
                    form={formId}
                    variant={isDirty ? "primary" : "outline"}
                    loading={isSubmitting}
                    disabled={lifecyclePending}
                  >
                    {t("save")}
                  </Button>
                </div>
                {removedBlocks.length && blocks.fields.length >= 200 ? (
                  <p className="text-muted-foreground text-sm">
                    {t("undoLimit")}
                  </p>
                ) : null}
                {errors.root?.message ? (
                  <p role="alert" className="text-foreground text-sm">
                    {errors.root.message}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm" role="note">
                {t("readOnly")}
              </p>
            )}
          </div>
          <IssueDeliveryOutcome issue={currentIssue} projectId={projectId} />
          <IssueActions
            issue={currentIssue}
            projectId={projectId}
            activeSubscribers={activeSubscribers}
            senderName={newsletter.senderName}
            sendingDomain={sendingDomain}
            disabled={unsaved || isSubmitting}
            disabledHint={
              isDirty
                ? t("Lifecycle.saveFirst")
                : designDirty
                  ? t("Studio.saveDesignFirst")
                  : undefined
            }
            onChanged={setCurrentIssue}
            onBusyChange={setLifecyclePending}
          />
        </aside>
        <div className="min-w-0 lg:col-start-1 lg:row-start-2 2xl:col-start-2 2xl:row-start-1">
          <NewsletterIssuePreview
            projectId={projectId}
            values={{ subject, previewText, template, content }}
            brand={newsletterBrandForPreview({
              ...newsletterSettingsValues(newsletter),
              ...design,
            })}
          />
        </div>
      </div>
    </div>
  );
}

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ChevronDown,
  ChevronUp,
  LinkIcon,
  Loader2,
  Lock,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { Fragment, ReactNode, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { MiddleTruncate } from "@/components/middle-truncate";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getEnvPublicConfig } from "@/config/env.public";
import { siteConfig } from "@/config/site";
import { useAsyncRouter } from "@/hooks/use-async-router";
import useModal from "@/hooks/use-modal";
import { CommonErrorCode, JobErrorCode, updateJobName } from "@/lib/actions";
import {
  convertCentsToCredits,
  isPubliclyShared,
  JobWithStatus,
} from "@/lib/db";
import {
  jobDetailsNameFormSchema,
  JobDetailsNameFormSchemaType,
} from "@/lib/schemas";
import { cn } from "@/lib/utils";

import JobShareModal from "./job-share-modal";

export default function JobDetailsName({
  job,
  readOnly,
}: {
  job: JobWithStatus;
  readOnly: boolean;
}) {
  const t = useTranslations("Components.Jobs.JobDetails.Header.JobName");
  const { name } = job;
  const sharedPublicly = isPubliclyShared(job);

  const { showModal, Component } = useModal(({ open, onOpenChange }) => (
    <JobShareModal open={open} onOpenChange={onOpenChange} job={job} />
  ));

  const router = useAsyncRouter();
  const [editing, setEditing] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const form = useForm<JobDetailsNameFormSchemaType>({
    resolver: zodResolver(
      jobDetailsNameFormSchema(
        useTranslations("Components.Jobs.JobDetails.Header.JobName.Schema"),
      ),
    ),
    defaultValues: {
      name: name ?? "",
    },
  });

  const handleEdit = () => {
    setEditing(true);
  };

  const handleCancel = () => {
    setEditing(false);
    form.reset({ name: name ?? "" });
  };

  const handleShareIndicatorClick = () => {
    if (readOnly) {
      return;
    }
    showModal();
  };

  const handleSubmit = async (data: JobDetailsNameFormSchemaType) => {
    const result = await updateJobName({ jobId: job.id, data });
    if (result.ok) {
      setEditing(false);
      toast.success(t("success"));
      router.refresh();
    } else {
      switch (result.error.code) {
        case CommonErrorCode.UNAUTHENTICATED:
          toast.error(t("Errors.unauthenticated"), {
            action: {
              label: t("Errors.unauthenticatedAction"),
              onClick: async () => {
                await router.push(`/login`);
              },
            },
          });
          break;
        case JobErrorCode.JOB_NOT_FOUND:
          toast.error(t("Errors.jobNotFound"));
          break;
        case CommonErrorCode.UNAUTHORIZED:
          toast.error(t("Errors.unauthorized"));
          break;
        default:
          toast.error(t("error"));
          break;
      }
    }
  };

  const startedAt = job.startedAt;
  const finishedAt = job.completedAt;
  const txId = job.onChainTransactionHash;
  const jobId = job.id;
  const cost = Math.abs(convertCentsToCredits(job.creditTransaction.amount));

  const isCollapsible = !editing; // collapse disabled while editing name

  return (
    <div className="bg-muted/50 flex items-center justify-between gap-2 rounded-xl p-4">
      <Collapsible className="w-full" open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <div className="flex items-center justify-between gap-2">
            {editing ? (
              <>
                <Form {...form}>
                  <form
                    onSubmit={form.handleSubmit(handleSubmit)}
                    className="flex w-full items-start gap-2"
                  >
                    <FormField
                      key="name"
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem className="flex-1">
                          <FormControl>
                            <Input
                              placeholder={t("Form.Name.placeholder")}
                              type="text"
                              {...field}
                              value={field.value ?? ""}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button
                      size="sm"
                      type="submit"
                      disabled={form.formState.isSubmitting}
                    >
                      {form.formState.isSubmitting && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      {t("save")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      type="reset"
                      disabled={form.formState.isSubmitting}
                      onClick={handleCancel}
                    >
                      {t("cancel")}
                    </Button>
                  </form>
                </Form>
              </>
            ) : (
              <>
                <div className="flex w-full items-center gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <p className="truncate">{name ?? t("noName")}</p>
                    <Tooltip>
                      <TooltipTrigger onClick={handleShareIndicatorClick}>
                        {sharedPublicly ? (
                          <Users className="h-4 w-4" />
                        ) : (
                          <Lock className="h-4 w-4" />
                        )}
                      </TooltipTrigger>
                      <TooltipContent>
                        {sharedPublicly ? t("shared") : t("private")}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  {!readOnly && (
                    <Button variant="outline" size="sm" onClick={handleEdit}>
                      {t("edit")}
                    </Button>
                  )}
                  {isCollapsible && (
                    <span className="text-muted-foreground ml-auto inline-flex h-4 w-4 items-center justify-center">
                      {isOpen ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </span>
                  )}
                </div>
              </>
            )}
            {!readOnly && Component}
          </div>
        </CollapsibleTrigger>
        {isCollapsible && (
          <CollapsibleContent>
            <JobMetaDetails
              jobId={jobId}
              txId={txId}
              startedAt={startedAt}
              finishedAt={finishedAt}
              cost={cost}
            />
          </CollapsibleContent>
        )}
      </Collapsible>
    </div>
  );
}

function JobMetaDetails({
  jobId,
  txId,
  startedAt,
  finishedAt,
  cost,
}: {
  jobId: string;
  txId: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  cost: number;
}) {
  const isMainnet = getEnvPublicConfig().NEXT_PUBLIC_NETWORK === "Mainnet";

  const formatter = useFormatter();
  const t = useTranslations("Components.Jobs.JobDetails.Meta");
  const items = [
    {
      key: "jobId",
      label: t("jobId"),
      rowClassName: "",
      content: (
        <Link
          href={siteConfig.links.jobDetails.concat(jobId)}
          className={"flex items-center gap-1 text-sm md:text-base"}
          target="_blank"
        >
          <LinkIcon className="h-4 w-4" />
          <MiddleTruncate text={jobId} />
        </Link>
      ),
    },
    {
      key: "txId",
      label: t("txId"),
      rowClassName: "pb-1",
      content: txId ? (
        <Link
          href={
            isMainnet
              ? siteConfig.links.jobTransactionMainnet.concat(txId)
              : siteConfig.links.jobTransactionPreprod.concat(txId)
          }
          className={"flex items-center gap-1 text-sm md:text-base"}
          target="_blank"
        >
          <LinkIcon className="h-4 w-4" />
          <MiddleTruncate text={txId} />
        </Link>
      ) : (
        <span>{"-"}</span>
      ),
    },
    {
      key: "started",
      label: t("started"),
      rowClassName: "pb-1",
      content: formatter.dateTime(startedAt, {
        dateStyle: "medium",
        timeStyle: "medium",
      }),
    },
    {
      key: "finished",
      label: t("finished"),
      rowClassName: "pb-1",
      content: finishedAt
        ? formatter.dateTime(finishedAt, {
            dateStyle: "medium",
            timeStyle: "medium",
          })
        : "-",
    },
    {
      key: "cost",
      label: t("cost"),
      rowClassName: "",
      content: cost,
    },
  ] as const;

  return (
    <div className="pt-6">
      {items.map((item, index) => (
        <Fragment key={item.key}>
          <KeyValueRow label={item.label} rowClassName={item.rowClassName}>
            {item.content}
          </KeyValueRow>
          {index < items.length - 1 && <Separator className="my-2" />}
        </Fragment>
      ))}
    </div>
  );
}

function KeyValueRow({
  label,
  children,
  rowClassName = "",
}: {
  label: string;
  children: ReactNode;
  rowClassName?: string;
}) {
  return (
    <div
      className={cn(
        `grid grid-cols-2 items-start gap-4 text-base md:grid-cols-3`,
        rowClassName,
      )}
    >
      <span className="font-bold break-all md:col-span-1">{label}</span>
      <div className="break-all md:col-span-2">{children}</div>
    </div>
  );
}

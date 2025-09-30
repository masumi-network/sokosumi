"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ChevronDown,
  ChevronUp,
  Globe,
  Loader2,
  Lock,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { ReactNode, useState } from "react";
import { useForm, UseFormReturn } from "react-hook-form";
import { toast } from "sonner";

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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAsyncRouter } from "@/hooks/use-async-router";
import useModal from "@/hooks/use-modal";
import { CommonErrorCode, JobErrorCode, updateJobName } from "@/lib/actions";
import {
  isOrganizationShared,
  isPubliclyShared,
  JobWithStatus,
} from "@/lib/db";
import {
  jobDetailsNameFormSchema,
  JobDetailsNameFormSchemaType,
} from "@/lib/schemas";

import JobMetaDetails from "./job-meta-details";
import JobShareModal from "./job-share-modal";

interface JobNameContentProps {
  editing: boolean;
  form: UseFormReturn<JobDetailsNameFormSchemaType>;
  name: string | null;
  sharedPublicly: boolean;
  sharedWithOrganization: boolean;
  readOnly: boolean;
  isOpen: boolean;
  handleSubmit: (data: JobDetailsNameFormSchemaType) => Promise<void>;
  handleCancel: () => void;
  handleEdit: () => void;
  handleShareIndicatorClick: () => void;
  t: ReturnType<typeof useTranslations>;
}

function JobNameContent({
  editing,
  form,
  name,
  sharedPublicly,
  sharedWithOrganization,
  readOnly,
  isOpen,
  handleSubmit,
  handleCancel,
  handleEdit,
  handleShareIndicatorClick,
  t,
}: JobNameContentProps) {
  if (editing) {
    return (
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
    );
  }

  return (
    <CollapsibleTrigger asChild>
      <div className="flex w-full cursor-default items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <p className="truncate">{name ?? t("noName")}</p>
          <Tooltip>
            <TooltipTrigger onClick={handleShareIndicatorClick}>
              {sharedPublicly ? (
                <Globe className="h-4 w-4" />
              ) : sharedWithOrganization ? (
                <Users className="h-4 w-4" />
              ) : (
                <Lock className="h-4 w-4" />
              )}
            </TooltipTrigger>
            <TooltipContent>
              {sharedPublicly
                ? t("shared")
                : sharedWithOrganization
                  ? t("organizationShared")
                  : t("private")}
            </TooltipContent>
          </Tooltip>
        </div>
        {!readOnly && (
          <Button variant="outline" size="sm" onClick={handleEdit}>
            {t("edit")}
          </Button>
        )}

        <span className="text-muted-foreground ml-auto inline-flex h-4 w-4 cursor-pointer items-center justify-center">
          {isOpen ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </span>
      </div>
    </CollapsibleTrigger>
  );
}

interface JobNameWrapperProps {
  children: ReactNode;
  readOnly: boolean;
  Component: ReactNode;
}

function JobNameWrapper({
  children,
  readOnly,
  Component,
}: JobNameWrapperProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      {children}
      {!readOnly && Component}
    </div>
  );
}

export default function JobDetailsName({
  job,
  readOnly,
  activeOrganizationId,
}: {
  job: JobWithStatus;
  readOnly: boolean;
  activeOrganizationId?: string | null;
}) {
  const t = useTranslations("Components.Jobs.JobDetails.Header.JobName");
  const { name } = job;
  const sharedPublicly = isPubliclyShared(job);
  const sharedWithOrganization = isOrganizationShared(job);

  const { showModal, Component } = useModal(({ open, onOpenChange }) => (
    <JobShareModal
      open={open}
      onOpenChange={onOpenChange}
      job={job}
      activeOrganizationId={activeOrganizationId}
    />
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
    setIsOpen(false);
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

  const isCollapsible = !editing; // collapse disabled while editing name

  const contentProps: JobNameContentProps = {
    editing,
    form,
    name,
    sharedPublicly,
    sharedWithOrganization,
    readOnly,
    isOpen,
    handleSubmit,
    handleCancel,
    handleEdit,
    handleShareIndicatorClick,
    t,
  };

  return (
    <div className="bg-muted/50 flex items-center justify-between gap-2 rounded-xl p-4">
      <Collapsible className="w-full" open={isOpen} onOpenChange={setIsOpen}>
        {isCollapsible ? (
          <>
            <JobNameWrapper readOnly={readOnly} Component={Component}>
              <JobNameContent {...contentProps} />
            </JobNameWrapper>
            <CollapsibleContent>
              <JobMetaDetails job={job} />
            </CollapsibleContent>
          </>
        ) : (
          <JobNameWrapper readOnly={readOnly} Component={Component}>
            <JobNameContent {...contentProps} />
          </JobNameWrapper>
        )}
      </Collapsible>
    </div>
  );
}

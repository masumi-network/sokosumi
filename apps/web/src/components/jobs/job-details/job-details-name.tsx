"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { JobWithSokosumiStatus } from "@sokosumi/database";
import { Globe, Loader2, Lock, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ReactNode, useState } from "react";
import { useForm, UseFormReturn } from "react-hook-form";
import { toast } from "sonner";

import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
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
import useModal from "@/hooks/use-modal";
import { CommonErrorCode, JobErrorCode, updateJobName } from "@/lib/actions";
import { isSharedPublicly, isSharedWithOrganization } from "@/lib/helpers/job";
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
  handleSubmit,
  handleCancel,
  handleEdit,
  handleShareIndicatorClick,
  t,
}: JobNameContentProps) {
  const { isSubmitting } = form.formState;

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
          <Button size="sm" type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
            {t("save")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            type="reset"
            disabled={isSubmitting}
            onClick={handleCancel}
          >
            {t("cancel")}
          </Button>
        </form>
      </Form>
    );
  }

  return (
    <AccordionTrigger className="w-full items-center px-0 py-0">
      <div className="flex w-full cursor-default items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <p className="flex-1 truncate text-base">{name ?? t("noName")}</p>
          <Tooltip>
            <TooltipTrigger
              asChild
              onClick={(event) => {
                event.stopPropagation();
                handleShareIndicatorClick();
              }}
            >
              {sharedPublicly ? (
                <Globe className="size-4" />
              ) : sharedWithOrganization ? (
                <Users className="size-4" />
              ) : (
                <Lock className="size-4" />
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
          <Button
            asChild
            variant="outline"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              handleEdit();
            }}
          >
            <span>{t("edit")}</span>
          </Button>
        )}
      </div>
    </AccordionTrigger>
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
    <div className="inline w-full max-w-full items-center justify-between gap-2">
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
  job: JobWithSokosumiStatus;
  readOnly: boolean;
  activeOrganizationId?: string | null;
}) {
  const t = useTranslations("Components.Jobs.JobDetails.Header.JobName");
  const { name } = job;
  const sharedPublicly = isSharedPublicly(job);
  const sharedWithOrganization = isSharedWithOrganization(
    job,
    activeOrganizationId,
  );

  const { showModal, Component } = useModal(({ open, onOpenChange }) => (
    <JobShareModal
      open={open}
      onOpenChange={onOpenChange}
      job={job}
      activeOrganizationId={activeOrganizationId}
    />
  ));

  const router = useRouter();
  const [editing, setEditing] = useState(false);

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
              onClick: () => {
                router.push(`/login`);
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
    handleSubmit,
    handleCancel,
    handleEdit,
    handleShareIndicatorClick,
    t,
  };

  return (
    <div className="bg-muted/50 flex items-center justify-between gap-2 rounded-xl border p-4">
      {isCollapsible ? (
        <AccordionItem value="meta" className="w-full border-0">
          <JobNameWrapper readOnly={readOnly} Component={Component}>
            <JobNameContent {...contentProps} />
          </JobNameWrapper>
          <AccordionContent className="px-0">
            <JobMetaDetails job={job} />
          </AccordionContent>
        </AccordionItem>
      ) : (
        <JobNameWrapper readOnly={readOnly} Component={Component}>
          <JobNameContent {...contentProps} />
        </JobNameWrapper>
      )}
    </div>
  );
}

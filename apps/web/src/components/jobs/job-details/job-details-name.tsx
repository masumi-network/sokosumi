"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { type UseFormReturn, useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { CommonErrorCode, JobErrorCode, updateJobName } from "@/lib/actions";
import type { Job } from "@/lib/clients/generated/core";
import {
  type JobDetailsNameFormSchemaType,
  jobDetailsNameFormSchema,
} from "@/lib/schemas";

export interface UseJobDetailsNameControllerResult {
  editing: boolean;
  form: UseFormReturn<JobDetailsNameFormSchemaType>;
  startEditing: () => void;
  cancelEditing: () => void;
  submit: (data: JobDetailsNameFormSchemaType) => Promise<void>;
}

interface JobDetailsNameProps {
  editing: boolean;
  name: string | null;
  form: UseFormReturn<JobDetailsNameFormSchemaType>;
  handleSubmit: (data: JobDetailsNameFormSchemaType) => Promise<void>;
  handleCancel: () => void;
}

export function useJobDetailsNameController(
  job: Job,
): UseJobDetailsNameControllerResult {
  const t = useTranslations("Components.Jobs.JobDetails.Header.JobName");
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const form = useForm<JobDetailsNameFormSchemaType>({
    resolver: zodResolver(
      jobDetailsNameFormSchema(
        useTranslations("Components.Jobs.JobDetails.Header.JobName.Schema"),
      ),
    ),
    defaultValues: {
      name: job.name ?? "",
    },
  });

  const startEditing = () => {
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    form.reset({ name: job.name ?? "" });
  };

  const submit = async (data: JobDetailsNameFormSchemaType) => {
    const result = await updateJobName({ jobId: job.id, data });
    if (result.ok) {
      setEditing(false);
      toast.success(t("success"));
      router.refresh();
      return;
    }

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
  };

  return {
    editing,
    form,
    startEditing,
    cancelEditing,
    submit,
  };
}

export default function JobDetailsName({
  editing,
  name,
  form,
  handleSubmit,
  handleCancel,
}: JobDetailsNameProps) {
  const t = useTranslations("Components.Jobs.JobDetails.Header.JobName");
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
    <p className="min-w-0 flex-1 text-xl leading-tight font-semibold tracking-tight wrap-break-word">
      {name ?? t("noName")}
    </p>
  );
}

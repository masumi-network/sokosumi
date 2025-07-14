"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
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
import { useAsyncRouter } from "@/hooks/use-async-router";
import { CommonErrorCode, JobErrorCode, updateJobName } from "@/lib/actions";
import { JobWithStatus } from "@/lib/db";
import {
  jobDetailsNameFormSchema,
  JobDetailsNameFormSchemaType,
} from "@/lib/schemas";

export default function JobDetailsName({ job }: { job: JobWithStatus }) {
  const t = useTranslations("App.Agents.Jobs.JobDetails.Header.JobName");
  const { name } = job;

  const router = useAsyncRouter();
  const [editing, setEditing] = useState(false);

  const form = useForm<JobDetailsNameFormSchemaType>({
    resolver: zodResolver(
      jobDetailsNameFormSchema(
        useTranslations("App.Agents.Jobs.JobDetails.Header.JobName.Schema"),
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

  const handleSubmit = async (data: JobDetailsNameFormSchemaType) => {
    const result = await updateJobName(job.id, data);
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

  return (
    <div className="bg-muted/50 flex items-center justify-between gap-2 rounded-xl p-4">
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
          <p className="flex-1 truncate">{name ?? t("noName")}</p>
          <Button variant="outline" size="sm" onClick={handleEdit}>
            {t("edit")}
          </Button>
        </>
      )}
    </div>
  );
}

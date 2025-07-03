"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { updateJobName } from "@/lib/actions";
import { JobWithStatus } from "@/lib/db";

const jobDetailsNameFormSchema = (
  t: IntlTranslation<"App.Agents.Jobs.JobDetails.Header">,
) =>
  z.object({
    name: z
      .string({ message: t("Schema.Name.invalid") })
      .min(2, { message: t("Schema.Name.min") })
      .max(80, { message: t("Schema.Name.max") })
      .or(z.literal("")),
  });

type JobDetailsNameFormSchemaType = z.infer<
  ReturnType<typeof jobDetailsNameFormSchema>
>;

export default function JobDetailsName({ job }: { job: JobWithStatus }) {
  const t = useTranslations("App.Agents.Jobs.JobDetails.Header");
  const { name } = job;

  const router = useRouter();
  const [editing, setEditing] = useState(false);

  const form = useForm<JobDetailsNameFormSchemaType>({
    resolver: zodResolver(jobDetailsNameFormSchema(t)),
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
    const result = await updateJobName(job.id, !!data.name ? data.name : null);
    if (result.success) {
      setEditing(false);
      toast.success(t("success"));
      router.refresh();
    } else {
      toast.error(t("error"));
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
          <p className="flex-1 truncate font-medium">{name ?? t("noName")}</p>
          <Button variant="outline" size="sm" onClick={handleEdit}>
            {t("edit")}
          </Button>
        </>
      )}
    </div>
  );
}

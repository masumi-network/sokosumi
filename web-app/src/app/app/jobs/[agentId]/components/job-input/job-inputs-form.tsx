import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { SubmitHandler, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import {
  defaultValues,
  JobInputsDataSchemaType,
  jobInputsFormSchema,
  JobInputsFormSchemaType,
} from "@/lib/job-input";
import { cn } from "@/lib/utils";

import JobInput from "./job-input";

interface JobInputsFormProps {
  credits: number;
  jobInputsDataSchema: JobInputsDataSchemaType;
  className?: string | undefined;
}

export default function JobInputsForm({
  credits,
  jobInputsDataSchema,
  className,
}: JobInputsFormProps) {
  const { input_data } = jobInputsDataSchema;
  const t = useTranslations("Library.JobInput.Form");
  const form = useForm<JobInputsFormSchemaType>({
    resolver: zodResolver(jobInputsFormSchema(input_data, t)),
    defaultValues: defaultValues(input_data),
  });

  const handleSubmit: SubmitHandler<JobInputsFormSchemaType> = (values) => {
    console.log(values);
  };

  const handleClear = () => {
    form.reset();
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)}>
        <fieldset
          disabled={form.formState.isSubmitting}
          className={cn("flex flex-1 flex-col gap-6", className)}
        >
          {input_data.map((jobInputSchema) => (
            <JobInput
              key={jobInputSchema.id}
              form={form}
              jobInputSchema={jobInputSchema}
            />
          ))}
          <div className="flex items-center justify-between gap-2">
            <Button type="reset" variant="outline" onClick={handleClear}>
              {t("clear")}
            </Button>
            <div className="flex items-center gap-2">
              <div className="text-muted-foreground text-sm">
                {t("price", { price: credits })}
              </div>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {t("submit")}
              </Button>
            </div>
          </div>
        </fieldset>
      </form>
    </Form>
  );
}

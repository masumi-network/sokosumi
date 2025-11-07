"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { JobWithStatus } from "@sokosumi/database";
import { ArrowUp, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import React from "react";
import {
  ControllerRenderProps,
  SubmitHandler,
  useForm,
  UseFormReturn,
} from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

import { InputField } from "@/components/create-job-modal/job-input/inputs/input-field";
import { InputGroupTextareaInput } from "@/components/create-job-modal/job-input/inputs/input-group-textarea-input";
import { isOptional } from "@/components/create-job-modal/job-input/util";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
} from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import {
  defaultValues,
  filterOutNullValues,
  jobInputSchema,
  JobInputSchemaType,
  jobInputsFormSchema,
  JobInputsFormSchemaType,
  ValidJobInputTypes,
} from "@/lib/job-input";

interface JobDetailsProvideInputProps {
  job: JobWithStatus;
}

export default function JobDetailsProvideInput({
  job,
}: JobDetailsProvideInputProps) {
  const t = useTranslations("Components.Jobs.JobDetails.AwaitingInput");
  const tForm = useTranslations("Library.JobInput.Form");
  const router = useRouter();

  // Parse input schema from job
  const inputSchemas = React.useMemo<JobInputSchemaType[]>(() => {
    try {
      if (job.inputSchema) {
        const parsed = JSON.parse(job.inputSchema);
        if (Array.isArray(parsed)) {
          const schemaResult = z.array(jobInputSchema()).safeParse(parsed);
          if (schemaResult.success) {
            return schemaResult.data;
          }
        }
      }
    } catch (_error) {
      console.error("Failed to parse input schema", _error);
    }
    return [];
  }, [job.inputSchema]);

  const form = useForm<JobInputsFormSchemaType>({
    resolver: zodResolver(jobInputsFormSchema(inputSchemas, tForm)),
    defaultValues: defaultValues(inputSchemas),
    mode: "onChange",
  });

  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const handleSubmit: SubmitHandler<JobInputsFormSchemaType> = async (
    values,
  ) => {
    setIsSubmitting(true);

    try {
      const transformedInputData = filterOutNullValues(values);

      // TODO: Handle agent input schema
      // const result = await provideJobInput({
      //   input: {
      //     jobId: job.id,
      //     inputData: transformedInputData,
      //   },
      // });

      // setIsSubmitting(false);

      // if (result.ok) {
      //   toast.success(t("submitSuccess"));
      //   router.refresh();
      // } else {
      //   console.log("result", result);
      //   switch (result.error.code) {
      //     case CommonErrorCode.UNAUTHENTICATED:
      //       toast.error(tForm("Error.unauthenticated"));
      //       break;
      //     case CommonErrorCode.BAD_INPUT:
      //       toast.error(tForm("Error.badInput"));
      //       break;
      //     default:
      //       toast.error(t("submitError"));
      //       break;
      //   }
      // }
    } catch (_error) {
      setIsSubmitting(false);
      toast.error(t("submitError"));
    }
  };

  const { isSubmitting: formIsSubmitting, isValid } = form.formState;

  // Helper function to check if a schema uses InputGroup
  const usesInputGroup = (schema: JobInputSchemaType) => {
    return (
      schema.type === ValidJobInputTypes.STRING ||
      schema.type === ValidJobInputTypes.TEXTAREA ||
      schema.type === ValidJobInputTypes.SEARCH
    );
  };

  // Find the last input field that uses InputGroup
  const lastInputGroupFieldId = React.useMemo(() => {
    const inputGroupFields = inputSchemas.filter(usesInputGroup);
    return inputGroupFields[inputGroupFields.length - 1]?.id;
  }, [inputSchemas]);

  if (inputSchemas.length === 0) {
    return (
      <div className="text-muted-foreground py-4 text-center">
        {t("noInputsRequired")}
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)}>
        <fieldset
          disabled={isSubmitting || formIsSubmitting}
          className="flex flex-1 flex-col gap-6"
        >
          {inputSchemas.map((jobInputSchema) => {
            const shouldUseInputGroup = usesInputGroup(jobInputSchema);
            const isLastInputGroupField =
              shouldUseInputGroup &&
              jobInputSchema.id === lastInputGroupFieldId;

            return (
              <FormField
                key={jobInputSchema.id}
                control={form.control}
                name={jobInputSchema.id}
                render={({ field }) => (
                  <FormItem>
                    {jobInputSchema.type !== ValidJobInputTypes.HIDDEN && (
                      <FormLabel htmlFor={jobInputSchema.id}>
                        {`${jobInputSchema.name} ${
                          isOptional(jobInputSchema) ? "" : "*"
                        }`}
                      </FormLabel>
                    )}
                    <FormControl>
                      {shouldUseInputGroup ? (
                        <InputGroupField
                          id={jobInputSchema.id}
                          field={field}
                          jobInputSchema={jobInputSchema}
                          form={form}
                          isLastInputGroupField={isLastInputGroupField}
                          isSubmitting={isSubmitting}
                        />
                      ) : (
                        <InputField
                          id={jobInputSchema.id}
                          field={field}
                          jobInputSchema={jobInputSchema}
                          form={form}
                        />
                      )}
                    </FormControl>
                    {jobInputSchema.type !== ValidJobInputTypes.HIDDEN &&
                      jobInputSchema.data?.description && (
                        <FormDescription>
                          {jobInputSchema.data.description}
                        </FormDescription>
                      )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            );
          })}
          {inputSchemas.every((schema) => !usesInputGroup(schema)) && (
            <div className="flex items-end justify-end gap-2">
              <Button
                type="submit"
                disabled={isSubmitting || formIsSubmitting || !isValid}
              >
                {(isSubmitting || formIsSubmitting) && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                {t("submit")}
              </Button>
            </div>
          )}
        </fieldset>
      </form>
    </Form>
  );
}

interface InputGroupFieldProps {
  id: string;
  field: ControllerRenderProps<JobInputsFormSchemaType>;
  jobInputSchema: JobInputSchemaType;
  form: UseFormReturn<JobInputsFormSchemaType>;
  isLastInputGroupField: boolean;
  isSubmitting: boolean;
}

function InputGroupField({
  id,
  field,
  jobInputSchema,
  form,
  isLastInputGroupField,
  isSubmitting,
}: InputGroupFieldProps) {
  const t = useTranslations("Components.Jobs.JobDetails.AwaitingInput");
  const { isSubmitting: formIsSubmitting, isValid } = form.formState;

  return (
    <>
      {jobInputSchema.type === ValidJobInputTypes.TEXTAREA ||
      jobInputSchema.type === ValidJobInputTypes.STRING ||
      jobInputSchema.type === ValidJobInputTypes.SEARCH ? (
        <InputGroup className="gap-2">
          <InputGroupTextareaInput
            id={id}
            field={field}
            jobInputSchema={jobInputSchema}
            form={form}
          />
          {isLastInputGroupField && (
            <InputGroupAddon align="block-end">
              <Separator orientation="vertical" className="ml-auto h-4" />
              <InputGroupButton
                type="submit"
                variant="default"
                className="rounded-full"
                size="icon-xs"
                disabled={isSubmitting || formIsSubmitting || !isValid}
              >
                {isSubmitting || formIsSubmitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ArrowUp />
                )}
                <span className="sr-only">{t("submit")}</span>
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
      ) : null}
    </>
  );
}

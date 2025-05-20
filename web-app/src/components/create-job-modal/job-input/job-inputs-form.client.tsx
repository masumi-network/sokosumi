"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import React from "react";
import { SubmitHandler, useForm } from "react-hook-form";
import { toast } from "sonner";

import { useCreateJobModalContext } from "@/components/create-job-modal";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { useAsyncRouterPush } from "@/hooks/use-async-router";
import { StartJobErrorCodes, startJobWithInputData } from "@/lib/actions";
import { AgentLegal, convertCentsToCredits, CreditsPrice } from "@/lib/db";
import {
  defaultValues,
  JobInputData,
  JobInputsDataSchemaType,
  jobInputsFormSchema,
  JobInputsFormSchemaType,
} from "@/lib/job-input";
import { cn } from "@/lib/utils";

import JobInput from "./job-input";

function filterOutNullValues(values: JobInputsFormSchemaType): JobInputData {
  return new Map(
    Object.entries(values).filter(([_, value]) => value !== null) as [
      string,
      string | number | boolean | number[],
    ][],
  );
}

interface JobInputsFormClientProps {
  agentId: string;
  agentCreditsPrice: CreditsPrice;
  jobInputsDataSchema: JobInputsDataSchemaType;
  legal?: AgentLegal | null | undefined;
  className?: string | undefined;
}

export default function JobInputsFormClient({
  agentId,
  agentCreditsPrice,
  jobInputsDataSchema,
  legal,
  className,
}: JobInputsFormClientProps) {
  const { input_data } = jobInputsDataSchema;
  const t = useTranslations("Library.JobInput.Form");
  const form = useForm<JobInputsFormSchemaType>({
    resolver: zodResolver(jobInputsFormSchema(input_data, t)),
    defaultValues: defaultValues(input_data),
    mode: "onChange",
  });
  const asyncRouter = useAsyncRouterPush();
  const router = useRouter();

  // create job modal context
  const { setLoading, handleClose } = useCreateJobModalContext();

  // Then replace your existing handleSubmit function with this:
  const handleSubmit: SubmitHandler<JobInputsFormSchemaType> = async (
    values,
  ) => {
    try {
      setLoading(true);

      // Transform input data to match expected type
      // Filter out null values and ensure arrays are of correct type
      const transformedInputData = filterOutNullValues(values);
      const result = await startJobWithInputData({
        agentId: agentId,
        maxAcceptedCents: agentCreditsPrice.cents,
        inputData: transformedInputData,
      });

      if (result.success && result.data?.jobId) {
        form.reset();
        handleClose();
        await asyncRouter.push(
          `/app/agents/${agentId}/jobs/${result.data.jobId}`,
        );
      } else {
        switch (result.error?.code) {
          case StartJobErrorCodes.INSUFFICIENT_BALANCE:
            toast.error(t("Error.insufficientBalance"), {
              action: {
                label: t("Error.insufficientBalanceAction"),
                onClick: () => {
                  router.push(`/app/billing`);
                },
              },
            });
            break;
          case StartJobErrorCodes.INVALID_INPUT:
            toast.error(t("Error.invalidInput"));
            break;
          case StartJobErrorCodes.NOT_AUTHENTICATED:
            toast.error(t("Error.notAuthenticated"), {
              action: {
                label: t("Error.notAuthenticatedAction"),
                onClick: () => {
                  router.push(`/login`);
                },
              },
            });
            break;
          default:
            toast.error(t("Error.default"));
            break;
        }
      }
    } catch {
      toast.error(t("Error.default"));
    } finally {
      setLoading(false);
    }
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
          <div className="flex items-end justify-between gap-2">
            <Button type="reset" variant="secondary" onClick={handleClear}>
              {t("clear")}
            </Button>
            <div className="flex flex-col items-end gap-2">
              <AcceptTermsOfService legal={legal} />
              <div className="flex items-center gap-2">
                <div className="text-muted-foreground text-sm">
                  {t("price", {
                    price: convertCentsToCredits(agentCreditsPrice.cents),
                  })}
                </div>
                <Button
                  type="submit"
                  disabled={
                    form.formState.isSubmitting || !form.formState.isValid
                  }
                >
                  {form.formState.isSubmitting && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {t("submit")}
                </Button>
              </div>
            </div>
          </div>
        </fieldset>
      </form>
    </Form>
  );
}

function AcceptTermsOfService({
  legal,
}: {
  legal?: AgentLegal | null | undefined;
}) {
  const t = useTranslations("Library.JobInput.Form");

  if (!legal) {
    return null;
  }

  const legalLinks = filterLegalLinks(legal, t);

  return (
    <div className="text-muted-foreground text-right text-xs">
      <span>{t("acceptByClickingSubmit")}</span>
      {legalLinks.map((legalLink, index) => (
        <React.Fragment key={index}>
          <Link href={legalLink.href} className="text-foreground">
            <span>{legalLink.label}</span>
          </Link>
          {index < legalLinks.length - 1 && ", "}
        </React.Fragment>
      ))}

      <span>{t("byCreator")}</span>
    </div>
  );
}

function filterLegalLinks(
  legal: AgentLegal,
  t: IntlTranslation<"Library.JobInput.Form">,
) {
  return [
    {
      href: legal?.terms,
      label: t("termsOfService"),
    },
    {
      href: legal?.privacyPolicy,
      label: t("privacyPolicy"),
    },
    {
      href: legal?.other,
      label: t("legal"),
    },
  ].filter((legalLink) => !!legalLink.href) as {
    href: string;
    label: string;
  }[];
}

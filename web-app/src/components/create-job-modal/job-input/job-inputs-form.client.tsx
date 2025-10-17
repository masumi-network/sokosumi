"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { track } from "@vercel/analytics";
import { Command, CornerDownLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import React from "react";
import { SubmitHandler, useForm } from "react-hook-form";
import { toast } from "sonner";

import { useCreateJobModalContext } from "@/components/create-job-modal";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { useAsyncRouter } from "@/hooks/use-async-router";
import usePreventEnterSubmit from "@/hooks/use-prevent-enter-submit";
import {
  CommonErrorCode,
  JobErrorCode,
  startDemoJob,
  startJob,
} from "@/lib/actions";
import {
  AgentDemoValues,
  AgentLegal,
  AgentWithCreditsPrice,
  convertCentsToCredits,
  getAgentName,
} from "@/lib/db";
import { fireGTMEvent } from "@/lib/gtm-events";
import {
  defaultValues,
  filterOutNullValues,
  JobInputsDataSchemaType,
  jobInputsFormSchema,
  JobInputsFormSchemaType,
} from "@/lib/job-input";
import { cn, formatDuration, getOSFromUserAgent } from "@/lib/utils";

import JobInput from "./job-input";

interface JobInputsFormClientProps {
  agent: AgentWithCreditsPrice;
  averageExecutionDuration: number;
  jobInputsDataSchema: JobInputsDataSchemaType;
  demoValues: AgentDemoValues | null;
  legal: AgentLegal | null;
  className?: string | undefined;
}

export default function JobInputsFormClient({
  agent,
  averageExecutionDuration,
  jobInputsDataSchema,
  demoValues,
  legal,
  className,
}: JobInputsFormClientProps) {
  const { id: agentId, creditsPrice } = agent;
  const { input_data } = jobInputsDataSchema;
  const t = useTranslations("Library.JobInput.Form");
  const tDuration = useTranslations("Library.Duration.Short");

  const form = useForm<JobInputsFormSchemaType>({
    resolver: zodResolver(jobInputsFormSchema(input_data, t)),
    defaultValues: demoValues ? demoValues.input : defaultValues(input_data),
    mode: "onChange",
  });
  const router = useAsyncRouter();

  const { os, isMobile } = getOSFromUserAgent();

  // create job modal context
  const { open, loading, setLoading, handleClose } = useCreateJobModalContext();

  const handleSubmit: SubmitHandler<JobInputsFormSchemaType> = async (
    values,
  ) => {
    track("Agent hired", {
      agentName: getAgentName(agent),
      credits: convertCentsToCredits(creditsPrice.cents),
    });

    setLoading(true);

    let result;
    // Transform input data to match expected type
    // Filter out null values and ensure arrays are of correct type
    const transformedInputData = filterOutNullValues(values);

    if (demoValues) {
      result = await startDemoJob({
        input: {
          agentId: agentId,
          inputSchema: input_data,
          inputData: filterOutNullValues(demoValues.input),
        },
        jobStatusResponse: demoValues.output,
      });
    } else {
      result = await startJob({
        input: {
          agentId: agentId,
          maxAcceptedCents: creditsPrice.cents,
          inputSchema: input_data,
          inputData: transformedInputData,
        },
      });
    }

    setLoading(false);
    if (result.ok) {
      fireGTMEvent.agentHired(
        getAgentName(agent),
        convertCentsToCredits(creditsPrice.cents),
      );
      // close modal
      handleClose();
      await router.push(`/agents/${agentId}/jobs/${result.data.jobId}`);
    } else {
      switch (result.error.code) {
        case CommonErrorCode.UNAUTHENTICATED:
          toast.error(t("Error.unauthenticated"), {
            action: {
              label: t("Error.unauthenticatedAction"),
              onClick: async () => await router.push(`/login`),
            },
          });
          break;
        case CommonErrorCode.BAD_INPUT:
          toast.error(t("Error.badInput"));
          break;
        case JobErrorCode.INSUFFICIENT_BALANCE:
          toast.error(t("Error.insufficientBalance"), {
            action: {
              label: t("Error.insufficientBalanceAction"),
              onClick: async () => await router.push(`/billing`),
            },
          });
          break;
        default:
          toast.error(t("Error.default"));
          break;
      }
    }
  };

  const { formRef, handleSubmit: enterPreventedHandleSubmit } =
    usePreventEnterSubmit(form, handleSubmit, open);

  const handleClear = () => {
    form.reset();
  };

  const formattedDuration = formatDuration(averageExecutionDuration, tDuration);
  const isDemo = !!demoValues;

  return (
    <Form {...form}>
      <form ref={formRef} onSubmit={enterPreventedHandleSubmit}>
        <fieldset
          disabled={loading || form.formState.isSubmitting}
          className={cn("flex flex-1 flex-col gap-6", className)}
        >
          {input_data.map((jobInputSchema) => (
            <JobInput
              key={jobInputSchema.id}
              form={form}
              jobInputSchema={jobInputSchema}
              disabled={isDemo}
            />
          ))}
          <div className="flex items-end justify-between gap-2">
            <Button
              type="reset"
              variant="secondary"
              onClick={handleClear}
              disabled={isDemo}
            >
              {t("clear")}
            </Button>
            <div className="flex flex-col items-end gap-2">
              <AcceptTermsOfService legal={legal} />
              <div className="flex items-center gap-2">
                <div className="text-muted-foreground text-sm">
                  {t("price", {
                    price: isDemo
                      ? 0
                      : convertCentsToCredits(creditsPrice.cents),
                  })}
                </div>
                <Button
                  type="submit"
                  disabled={
                    loading ||
                    form.formState.isSubmitting ||
                    !form.formState.isValid
                  }
                  className="items-center justify-between gap-1"
                >
                  <div className="flex items-center gap-1">
                    {(loading || form.formState.isSubmitting) && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                    {t("submit")}
                  </div>
                  {!isDemo && averageExecutionDuration > 0 && (
                    <span>{`(~${formattedDuration})`}</span>
                  )}
                  {!isMobile && (
                    <div className="flex items-center gap-1">
                      {os === "MacOS" ? <Command /> : t("ctrl")}
                      <CornerDownLeft />
                    </div>
                  )}
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
          <Link
            target="_blank"
            href={legalLink.href}
            className="text-foreground"
          >
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

"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { CommonErrorCode } from "@/lib/actions";
import { provideJobInput } from "@/lib/actions/job/action";
import { filterOutNullValues, JobInputsFormSchemaType } from "@/lib/job-input";

export interface UseProvideJobInputOptions {
  jobId: string;
  statusId: string | null | undefined;
  onSuccess?: () => void;
}

export interface UseProvideJobInputReturn {
  handleSubmit: (values: JobInputsFormSchemaType) => Promise<void>;
  isSubmitting: boolean;
}

export function useProvideJobInput({
  jobId,
  statusId,
  onSuccess,
}: UseProvideJobInputOptions): UseProvideJobInputReturn {
  const t = useTranslations("Components.Jobs.JobDetails.AwaitingInput");
  const tForm = useTranslations("Library.JobInput.Form");
  const router = useRouter();

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (allValues: JobInputsFormSchemaType) => {
      setIsSubmitting(true);

      try {
        const transformedInputData = filterOutNullValues(allValues);

        if (!statusId) {
          throw new Error("Status ID is required");
        }

        const result = await provideJobInput({
          input: {
            jobId,
            statusId,
            inputData: transformedInputData,
          },
        });
        setIsSubmitting(false);

        if (result.ok) {
          toast.success(t("submitSuccess"));
          onSuccess?.();
          router.refresh();
        } else {
          switch (result.error.code) {
            case CommonErrorCode.UNAUTHENTICATED:
              toast.error(tForm("Error.unauthenticated"));
              break;
            case CommonErrorCode.BAD_INPUT:
              toast.error(tForm("Error.badInput"));
              break;
            default:
              toast.error(t("submitError"));
              break;
          }
        }
      } catch (_error) {
        setIsSubmitting(false);
        toast.error(t("submitError"));
      }
    },
    [jobId, statusId, t, tForm, router, onSuccess],
  );

  return { handleSubmit, isSubmitting };
}

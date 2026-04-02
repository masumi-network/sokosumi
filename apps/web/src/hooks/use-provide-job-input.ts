"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { CommonErrorCode } from "@/lib/actions";
import { provideJobInput } from "@/lib/actions/job/action";
import {
  type JobInputsFormSchemaType,
  prepareInputValues,
} from "@/lib/job-input";
import { mergeReadonlyInputValues } from "@/lib/utils/job-input-transformers";
import {
  getUserFileUploadErrorMessage,
  uploadInputDataFiles,
} from "@/lib/utils/user-file-upload.client";

export interface UseProvideJobInputOptions {
  jobId: string;
  eventId: string | null | undefined;
  readonlyInputValues?: Record<string, string>;
  inputFieldIdsInOrder?: string[];
  onSuccess?: () => void;
}

export interface UseProvideJobInputReturn {
  handleSubmit: (values: JobInputsFormSchemaType) => Promise<void>;
  isSubmitting: boolean;
}

export function useProvideJobInput({
  jobId,
  eventId,
  readonlyInputValues,
  inputFieldIdsInOrder,
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
        const transformedInputData = prepareInputValues(allValues);
        await uploadInputDataFiles(transformedInputData);
        const inputData = mergeReadonlyInputValues(
          transformedInputData,
          readonlyInputValues,
          inputFieldIdsInOrder,
        );

        if (!eventId) {
          throw new Error("Event ID is required");
        }

        const result = await provideJobInput({
          input: {
            jobId,
            eventId,
            inputData,
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
        toast.error(getUserFileUploadErrorMessage(_error, t("submitError")));
      }
    },
    [
      inputFieldIdsInOrder,
      jobId,
      onSuccess,
      readonlyInputValues,
      router,
      eventId,
      t,
      tForm,
    ],
  );

  return { handleSubmit, isSubmitting };
}

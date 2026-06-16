"use client";

import type { InputSchemaSchemaType } from "@sokosumi/masumi/schemas";
import type { AgentWithCreditsPrice } from "@sokosumi/utils";
import { convertCentsToCredits } from "@sokosumi/utils";
import { track } from "@vercel/analytics";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { toast } from "sonner";

import {
  CommonErrorCode,
  JobErrorCode,
  startDemoJob,
  startJob,
} from "@/lib/actions";
import { fireGTMEvent } from "@/lib/gtm-events";
import { getAgentName } from "@/lib/helpers/agent";
import {
  type JobInputsFormSchemaType,
  prepareInputValues,
} from "@/lib/job-input";
import type { AgentDemoValues } from "@/lib/types/agent";
import {
  getUserFileUploadErrorMessage,
  uploadInputDataFiles,
} from "@/lib/utils/user-file-upload.client";

export interface UseJobSubmissionOptions {
  agent: AgentWithCreditsPrice;
  inputSchema: InputSchemaSchemaType;
  demoValues: AgentDemoValues | null;
  projectId?: string | null;
  setLoading: (loading: boolean) => void;
  onSuccess: () => void;
}

export interface UseJobSubmissionReturn {
  handleSubmit: (values: JobInputsFormSchemaType) => Promise<void>;
}

export function useJobSubmission({
  agent,
  inputSchema,
  demoValues,
  projectId,
  setLoading,
  onSuccess,
}: UseJobSubmissionOptions): UseJobSubmissionReturn {
  const { id: agentId, creditsPrice } = agent;
  const t = useTranslations("Library.JobInput.Form");
  const router = useRouter();

  const handleSubmit = useCallback(
    async (allValues: JobInputsFormSchemaType) => {
      setLoading(true);

      try {
        let result:
          | { ok: true; data: { jobId: string } }
          | { ok: false; error: { code: string } };
        const uploadFiles = async (
          inputData: ReturnType<typeof prepareInputValues>,
        ) => {
          try {
            await uploadInputDataFiles(inputData);
            return true;
          } catch (_error) {
            setLoading(false);
            toast.error(
              getUserFileUploadErrorMessage(_error, t("Error.default")),
            );
            return false;
          }
        };

        if (demoValues) {
          result = await startDemoJob({
            input: {
              agentId: agentId,
              inputSchema,
              inputData: prepareInputValues(demoValues.input),
              ...(typeof projectId !== "undefined" ? { projectId } : {}),
            },
            jobStatusResponse: demoValues.output,
          });
        } else {
          const transformedInputData = prepareInputValues(allValues);
          const didUploadFiles = await uploadFiles(transformedInputData);
          if (!didUploadFiles) return;

          result = await startJob({
            input: {
              agentId: agentId,
              maxAcceptedCents: creditsPrice.cents,
              inputSchema,
              inputData: transformedInputData,
              ...(typeof projectId !== "undefined" ? { projectId } : {}),
            },
          });
        }

        setLoading(false);
        if (result.ok) {
          fireGTMEvent.agentHired(
            getAgentName(agent),
            convertCentsToCredits(creditsPrice.cents),
          );
          track("Agent hired", {
            agentId: agentId,
            credits: convertCentsToCredits(creditsPrice.cents),
            jobId: result.data.jobId,
          });
          onSuccess();
          router.push(`/agents/${agentId}/jobs/${result.data.jobId}`);
        } else {
          switch (result.error.code) {
            case CommonErrorCode.UNAUTHENTICATED:
              toast.error(t("Error.unauthenticated"), {
                action: {
                  label: t("Error.unauthenticatedAction"),
                  onClick: () => router.push(`/login`),
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
                  onClick: () => router.push(`/billing?tab=credits`),
                },
              });
              break;
            default:
              toast.error(t("Error.default"));
              break;
          }
        }
      } catch (_error) {
        setLoading(false);
        toast.error(t("Error.default"));
      }
    },
    [
      setLoading,
      demoValues,
      projectId,
      agent,
      agentId,
      creditsPrice.cents,
      inputSchema,
      onSuccess,
      router,
      t,
    ],
  );

  return { handleSubmit };
}

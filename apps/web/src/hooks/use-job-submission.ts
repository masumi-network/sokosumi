"use client";

import { AgentWithCreditsPrice } from "@sokosumi/database";
import { convertCentsToCredits } from "@sokosumi/database/helpers";
import type { InputFieldSchemaType } from "@sokosumi/masumi/schemas";
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
import { createSchedule } from "@/lib/actions/job-schedule";
import { useSession } from "@/lib/auth/auth.client";
import { fireGTMEvent } from "@/lib/gtm-events";
import { getAgentName } from "@/lib/helpers/agent";
import { filterOutNullValues, JobInputsFormSchemaType } from "@/lib/job-input";
import { AgentDemoValues } from "@/lib/types/agent";
import { JobScheduleSelectionType, JobScheduleType } from "@/lib/types/job";

export interface UseJobSubmissionOptions {
  agent: AgentWithCreditsPrice;
  flatInputs: InputFieldSchemaType[];
  demoValues: AgentDemoValues | null;
  scheduleSelection: JobScheduleSelectionType | null;
  setLoading: (loading: boolean) => void;
  onSuccess: () => void;
}

export interface UseJobSubmissionReturn {
  handleSubmit: (values: JobInputsFormSchemaType) => Promise<void>;
}

export function useJobSubmission({
  agent,
  flatInputs,
  demoValues,
  scheduleSelection,
  setLoading,
  onSuccess,
}: UseJobSubmissionOptions): UseJobSubmissionReturn {
  const { id: agentId, creditsPrice } = agent;
  const t = useTranslations("Library.JobInput.Form");
  const session = useSession();
  const router = useRouter();

  const handleSubmit = useCallback(
    async (allValues: JobInputsFormSchemaType) => {
      setLoading(true);

      let result:
        | { ok: true; data: { jobId: string; scheduleId?: string } }
        | { ok: false; error: { code: string } };

      const transformedInputData = filterOutNullValues(allValues);

      if (demoValues) {
        result = await startDemoJob({
          input: {
            agentId: agentId,
            inputSchema: flatInputs,
            inputData: filterOutNullValues(demoValues.input),
          },
          jobStatusResponse: demoValues.output,
        });
      } else if (
        scheduleSelection &&
        scheduleSelection.mode !== JobScheduleType.NOW
      ) {
        if (!session.data) {
          result = {
            ok: false,
            error: { code: CommonErrorCode.UNAUTHENTICATED },
          };
          setLoading(false);
          return;
        }

        result = await createSchedule({
          input: {
            agentId: agentId,
            inputSchema: flatInputs,
            inputData: transformedInputData,
            maxAcceptedCents: creditsPrice.cents,
          },
          scheduleSelection: scheduleSelection,
        });
      } else {
        result = await startJob({
          input: {
            agentId: agentId,
            maxAcceptedCents: creditsPrice.cents,
            inputSchema: flatInputs,
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
        track("Agent hired", {
          agentId: agentId,
          credits: convertCentsToCredits(creditsPrice.cents),
          jobId: result.data.jobId,
        });
        onSuccess();
        if (result.data?.scheduleId) {
          router.push(`/schedules`);
        } else {
          router.push(`/agents/${agentId}/jobs/${result.data.jobId}`);
        }
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
                onClick: () => router.push(`/credits`),
              },
            });
            break;
          default:
            toast.error(t("Error.default"));
            break;
        }
      }
    },
    [
      setLoading,
      demoValues,
      scheduleSelection,
      agent,
      agentId,
      creditsPrice.cents,
      flatInputs,
      session.data,
      onSuccess,
      router,
      t,
    ],
  );

  return { handleSubmit };
}

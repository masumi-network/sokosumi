import { HydrationBoundary } from "@tanstack/react-query";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { AutoContextSwitch } from "@/app/components/auto-context-switch";
import type { Job, MemberWithOrganization } from "@/lib/clients/generated/core";
import { userService } from "@/lib/services/user.service";
import { resolveAccountName } from "@/lib/utils/account-name";

import { loadJobDetails } from "./load-job-details";

export interface JobDetailsPresentationProps {
  job: Job;
  organizations: MemberWithOrganization[];
  hasPersonalWorkspace: boolean;
  personalWorkspaceLabel: string;
  projectName: string | null;
  readOnly: boolean;
}

export async function JobDetailsView({
  agentId,
  jobId,
  children,
}: {
  agentId: string;
  jobId: string;
  children: (props: JobDetailsPresentationProps) => ReactNode;
}) {
  const [jobDetails, members, tOrganizationSwitcher, tJobs] = await Promise.all(
    [
      loadJobDetails({ agentId, jobId }),
      userService.getMyMembersWithOrganizations(),
      getTranslations("Components.OrganizationSwitcher"),
      getTranslations("App.Agents.Jobs"),
    ],
  );
  const {
    activeOrganizationId,
    dehydratedState,
    job,
    hasPersonalWorkspace,
    personalWorkspaceLabel,
    projectName,
    readOnly,
  } = jobDetails;
  const targetOrganizationId = job.workspace.organizationId ?? null;
  const targetAccountName = resolveAccountName(
    targetOrganizationId,
    members,
    tOrganizationSwitcher("personalAccount"),
  );
  const personalWorkspaceMoveLabel =
    personalWorkspaceLabel ?? tOrganizationSwitcher("personalAccount");

  return (
    <HydrationBoundary state={dehydratedState}>
      <AutoContextSwitch
        activeOrganizationId={activeOrganizationId}
        targetOrganizationId={targetOrganizationId}
        successMessage={tJobs("switchedWorkspace", {
          account: targetAccountName,
        })}
      />
      {children({
        job,
        organizations: members,
        hasPersonalWorkspace,
        personalWorkspaceLabel: personalWorkspaceMoveLabel,
        projectName,
        readOnly,
      })}
    </HydrationBoundary>
  );
}

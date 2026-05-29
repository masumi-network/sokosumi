import { HydrationBoundary } from "@tanstack/react-query";
import { getTranslations } from "next-intl/server";

import { loadJobDetails } from "@/app/agents/[agentId]/jobs/_lib/load-job-details";
import { JobDetailsModal } from "@/app/agents/[agentId]/jobs/components/job-details-modal";
import { AutoContextSwitch } from "@/app/components/auto-context-switch";
import { userService } from "@/lib/services/user.service";
import { resolveAccountName } from "@/lib/utils/account-name";

interface JobDetailsModalPageParams {
  agentId: string;
  jobId: string;
}

export default async function JobDetailsModalPage({
  params,
}: {
  params: Promise<JobDetailsModalPageParams>;
}) {
  const { agentId, jobId } = await params;
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
      <JobDetailsModal
        agentId={agentId}
        job={job}
        organizations={members}
        personalWorkspaceLabel={personalWorkspaceMoveLabel}
        projectName={projectName}
        readOnly={readOnly}
      />
    </HydrationBoundary>
  );
}

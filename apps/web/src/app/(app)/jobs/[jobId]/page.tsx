import { HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AutoContextSwitch } from "@/app/components/auto-context-switch";
import { JobDetails } from "@/components/jobs";
import { getAgentName } from "@/lib/helpers/agent";
import { loadJobDetails } from "@/lib/job/load-job-details";
import { userService } from "@/lib/services/user.service";
import { resolveAccountName } from "@/lib/utils/account-name";

interface JobDetailsPageParams {
  jobId: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<JobDetailsPageParams>;
}): Promise<Metadata> {
  const { jobId } = await params;
  // Deduped with the page render via React cache() inside loadJobDetails.
  const { job } = await loadJobDetails({ jobId });
  const jobName = job.name?.trim();
  return {
    title: jobName || getAgentName(job.agent) || jobId,
  };
}

export default async function JobDetailsPage({
  params,
}: {
  params: Promise<JobDetailsPageParams>;
}) {
  const { jobId } = await params;
  const [jobDetails, members, tOrganizationSwitcher, tJobs] = await Promise.all(
    [
      loadJobDetails({ jobId }),
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
      <JobDetails
        className="h-full"
        job={job}
        organizations={members}
        personalWorkspaceLabel={personalWorkspaceMoveLabel}
        projectName={projectName}
        readOnly={readOnly}
        showAgentHeader={false}
      />
    </HydrationBoundary>
  );
}

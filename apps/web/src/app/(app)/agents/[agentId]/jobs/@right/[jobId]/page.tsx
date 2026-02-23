import { HydrationBoundary } from "@tanstack/react-query";
import { getTranslations } from "next-intl/server";

import { loadJobDetails } from "@/app/agents/[agentId]/jobs/_lib/load-job-details";
import { AutoContextSwitch } from "@/app/components/auto-context-switch";
import { JobDetails } from "@/components/jobs";
import { userService } from "@/lib/services/user.service";

interface JobDetailsPageParams {
  agentId: string;
  jobId: string;
}

export default async function JobDetailsPage({
  params,
}: {
  params: Promise<JobDetailsPageParams>;
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
  const { activeOrganizationId, dehydratedState, job, readOnly } = jobDetails;
  const targetOrganizationId = job.organizationId;
  const targetAccountName = targetOrganizationId
    ? (members.find((member) => member.organizationId === targetOrganizationId)
        ?.organization.name ?? targetOrganizationId)
    : tOrganizationSwitcher("personalAccount");

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
        readOnly={readOnly}
        activeOrganizationId={activeOrganizationId}
      />
    </HydrationBoundary>
  );
}

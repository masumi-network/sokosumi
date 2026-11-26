import { mountView } from "../../shell/mount.tsx";
import { JobResult, JobStatus } from "./JobStatus.tsx";

mountView("job-status", {
  schema: JobResult,
  refreshTool: "jobs_get",
  children: (data, context) => <JobStatus data={data} context={context} />,
});

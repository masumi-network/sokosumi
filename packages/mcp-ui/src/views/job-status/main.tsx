import { mountView } from "../../shell/mount.tsx";
import { JobResult, JobStatus } from "./JobStatus.tsx";

mountView("job-status", {
  skeleton: "detail",
  schema: JobResult,
  refreshTool: "jobs_get",
  children: (data, context) => <JobStatus data={data} context={context} />,
});

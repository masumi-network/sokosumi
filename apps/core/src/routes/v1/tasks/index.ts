import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountDeleteTask from "./[id]/delete.js";
import mountGetTaskEvents from "./[id]/events/get.js";
import mountPostTaskEvents from "./[id]/events/post.js";
import mountGetTaskFiles from "./[id]/files/get.js";
import mountPostTaskFile from "./[id]/files/post.js";
import mountGetTaskById from "./[id]/get.js";
import mountGetTaskJobs from "./[id]/jobs/get.js";
import mountPostTaskJob from "./[id]/jobs/post.js";
import mountDeleteTaskLink from "./[id]/links/[linkId]/delete.js";
import mountPatchTaskLink from "./[id]/links/[linkId]/patch.js";
import mountGetTaskLinks from "./[id]/links/get.js";
import mountPostTaskLink from "./[id]/links/post.js";
import mountDeleteTaskParticipant from "./[id]/participants/[userId]/delete.js";
import mountPatchTask from "./[id]/patch.js";
import mountDeleteTaskShareById from "./[id]/share/delete.js";
import mountPutTaskShareById from "./[id]/share/put.js";
import mountGetTaskWorkspace from "./[id]/workspace/get.js";
import mountPutTaskWorkspace from "./[id]/workspace/put.js";
import mountPostTaskX402Payment from "./[id]/x402-payments/post.js";
import mountGetTasks from "./get.js";
import mountLegacyVendorSchedules from "./legacy-vendor-schedules/index.js";
import mountMovedTaskScheduleRoutes from "./moved-schedule-routes.js";
import mountPostTask from "./post.js";
import mountDeleteTaskScheduleById from "./schedules/[id]/delete.js";
import mountPostTaskScheduleEnd from "./schedules/[id]/end/post.js";
import mountGetTaskScheduleById from "./schedules/[id]/get.js";
import mountPatchTaskScheduleById from "./schedules/[id]/patch.js";
import mountPostTaskSchedulePause from "./schedules/[id]/pause/post.js";
import mountPostTaskScheduleResume from "./schedules/[id]/resume/post.js";
import mountPatchTaskScheduleRun from "./schedules/[id]/runs/[runId]/patch.js";
import mountGetTaskScheduleRuns from "./schedules/[id]/runs/get.js";
import mountGetTaskScheduleAssignees from "./schedules/assignees/get.js";
import mountGetTaskSchedules from "./schedules/get.js";
import mountPostTaskSchedule from "./schedules/post.js";
import mountGetTaskSummary from "./summary/get.js";

const app = new OpenAPIHonoWithAuth({
  includeWorkspaceContext: true,
  requireOrganizationProductSeat: true,
});

// Temporary middleware in front of the routes below; see its index.
mountLegacyVendorSchedules(app);
mountGetTasks(app);
// Before the `/{id}` routes so the literal path cannot be read as a task id.
mountGetTaskSummary(app);
mountGetTaskSchedules(app);
mountGetTaskScheduleAssignees(app);
mountPostTaskSchedule(app);
mountGetTaskScheduleById(app);
mountPatchTaskScheduleById(app);
mountDeleteTaskScheduleById(app);
mountPostTaskSchedulePause(app);
mountPostTaskScheduleResume(app);
mountPostTaskScheduleEnd(app);
mountGetTaskScheduleRuns(app);
mountPatchTaskScheduleRun(app);
mountPostTask(app);
mountMovedTaskScheduleRoutes(app);
mountGetTaskLinks(app);
mountPostTaskLink(app);
mountDeleteTaskLink(app);
mountPatchTaskLink(app);
mountDeleteTaskParticipant(app);
mountGetTaskById(app);
mountPatchTask(app);
mountPutTaskShareById(app);
mountDeleteTaskShareById(app);
mountGetTaskWorkspace(app);
mountPutTaskWorkspace(app);
mountDeleteTask(app);
mountGetTaskEvents(app);
mountPostTaskEvents(app);
mountGetTaskFiles(app);
mountPostTaskFile(app);
mountGetTaskJobs(app);
mountPostTaskJob(app);
mountPostTaskX402Payment(app);

export default app;

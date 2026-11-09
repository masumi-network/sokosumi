import { createNestedOpenAPIHono } from "@/lib/hono";
import mountListAdminEvalCases from "./cases/get.js";
import mountCancelAdminEvalRun from "./runs/[id]/cancel/post.js";
import mountGetAdminEvalCaseBaseline from "./runs/[id]/cases/[caseId]/baseline/get.js";
import mountGetAdminEvalRun from "./runs/[id]/get.js";
import mountListAdminEvalRuns from "./runs/get.js";
import mountCreateAdminEvalRun from "./runs/post.js";
import mountTickAdminEvalRuns from "./tick/post.js";

const app = createNestedOpenAPIHono();

mountListAdminEvalCases(app);
mountListAdminEvalRuns(app);
mountCreateAdminEvalRun(app);
mountGetAdminEvalRun(app);
mountCancelAdminEvalRun(app);
mountGetAdminEvalCaseBaseline(app);
mountTickAdminEvalRuns(app);

export default app;

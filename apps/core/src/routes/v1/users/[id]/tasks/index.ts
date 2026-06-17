import { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "../../user-route-context.js";
import mountGetUserTasksCount from "./count/get.js";

const app = new OpenAPIHonoWithAuth<UserRouteVariables>({
  includeWorkspaceContext: true,
});

app.use("*", usersPathUserContextMiddleware);

mountGetUserTasksCount(app);

export default app;

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountGetTransactions from "./get.js";

const app = new OpenAPIHonoWithAuth({
  includeWorkspaceContext: true,
});

mountGetTransactions(app);

export default app;

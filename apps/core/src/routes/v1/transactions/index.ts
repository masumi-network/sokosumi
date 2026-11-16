import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetTransactionsDaily from "./daily/get.js";
import mountExportTransactions from "./export/get.js";
import mountGetTransactions from "./get.js";
import mountGetTransactionsTotal from "./total/get.js";

const app = new OpenAPIHonoWithAuth({
  includeWorkspaceContext: true,
  requireOrganizationProductSeat: true,
});

mountGetTransactions(app);
mountGetTransactionsDaily(app);
mountExportTransactions(app);
mountGetTransactionsTotal(app);

export default app;

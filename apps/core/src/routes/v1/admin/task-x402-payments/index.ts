import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountRefundAdminTaskX402Payment from "./[id]/refund/post.js";
import mountResolveAdminTaskX402Payment from "./[id]/resolve/post.js";
import mountAggregateAdminTaskX402Payments from "./aggregate/get.js";
import mountListAdminTaskX402Payments from "./get.js";

const app = new OpenAPIHonoWithAuth();

mountListAdminTaskX402Payments(app);
mountAggregateAdminTaskX402Payments(app);
mountRefundAdminTaskX402Payment(app);
mountResolveAdminTaskX402Payment(app);

export default app;

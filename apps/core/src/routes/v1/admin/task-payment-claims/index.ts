import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountRefundAdminTaskPaymentClaim from "./[id]/refund/post.js";
import mountResolveAdminTaskPaymentClaim from "./[id]/resolve/post.js";
import mountRetryAdminTaskPaymentClaim from "./[id]/retry/post.js";
import mountListAdminTaskPaymentClaims from "./get.js";

const app = new OpenAPIHonoWithAuth();

mountListAdminTaskPaymentClaims(app);
mountRefundAdminTaskPaymentClaim(app);
mountResolveAdminTaskPaymentClaim(app);
mountRetryAdminTaskPaymentClaim(app);

export default app;

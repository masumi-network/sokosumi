import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountClaimCoupon from "./[couponId]/claim/post.js";
import mountGetCouponDetails from "./[couponId]/get.js";

const app = new OpenAPIHonoWithAuth();

mountGetCouponDetails(app);
mountClaimCoupon(app);

export default app;

import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountCreateCreditCheckoutSession from "./credits/post.js";
import mountGetCheckoutSessionAnalytics from "./sessions/[sessionId]/get.js";

const app = new OpenAPIHonoWithAuth({ mainnetOnly: true });

mountCreateCreditCheckoutSession(app);
mountGetCheckoutSessionAnalytics(app);

export default app;

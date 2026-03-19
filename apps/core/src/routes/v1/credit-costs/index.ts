import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountDeleteCreditCost from "./[id]/delete.js";
import mountGetCreditCostById from "./[id]/get.js";
import mountPatchCreditCost from "./[id]/patch.js";
import mountGetCreditCosts from "./get.js";
import mountPostCreditCost from "./post.js";

const app = new OpenAPIHonoWithAuth();

mountGetCreditCosts(app);
mountPostCreditCost(app);
mountGetCreditCostById(app);
mountPatchCreditCost(app);
mountDeleteCreditCost(app);

export default app;

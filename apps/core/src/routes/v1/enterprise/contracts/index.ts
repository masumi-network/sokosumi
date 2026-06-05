import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountActivateEnterpriseContract from "./[id]/activate/post.js";
import mountCancelEnterpriseContract from "./[id]/cancel/post.js";
import mountGetEnterpriseContractById from "./[id]/get.js";
import mountPatchEnterpriseContract from "./[id]/patch.js";
import mountPreviewEnterpriseContractPeriods from "./[id]/periods/preview/get.js";
import mountGetEnterpriseContracts from "./get.js";
import mountPostEnterpriseContract from "./post.js";

const app = new OpenAPIHonoWithAuth();

mountGetEnterpriseContracts(app);
mountPostEnterpriseContract(app);
mountPreviewEnterpriseContractPeriods(app);
mountGetEnterpriseContractById(app);
mountPatchEnterpriseContract(app);
mountActivateEnterpriseContract(app);
mountCancelEnterpriseContract(app);

export default app;

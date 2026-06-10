import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetOrganizationEnterpriseContractSummary from "./[id]/enterprise-contract-summary/get.js";
import mountGetOrganization from "./[id]/get.js";
import mountGetOrganizationInvitations from "./[id]/invitations/get.js";
import mountGetOrganizationMembers from "./[id]/members/get.js";

const app = new OpenAPIHonoWithAuth();

mountGetOrganization(app);
mountGetOrganizationMembers(app);
mountGetOrganizationInvitations(app);
mountGetOrganizationEnterpriseContractSummary(app);

export default app;

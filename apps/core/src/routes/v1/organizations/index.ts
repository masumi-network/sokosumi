import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetOrganizationDesignMd from "./[id]/design-md/get.js";
import mountPutOrganizationDesignMd from "./[id]/design-md/put.js";
import mountGetOrganizationEnterpriseContractSummary from "./[id]/enterprise-contract-summary/get.js";
import mountGetOrganization from "./[id]/get.js";
import mountGetOrganizationInvitations from "./[id]/invitations/get.js";
import mountGetOrganizationMembers from "./[id]/members/get.js";
import mountGetOrganizationStripeCustomer from "./[id]/stripe-customer/get.js";

const app = new OpenAPIHonoWithAuth();

mountGetOrganization(app);
mountGetOrganizationMembers(app);
mountGetOrganizationInvitations(app);
mountGetOrganizationEnterpriseContractSummary(app);
mountGetOrganizationStripeCustomer(app);
mountGetOrganizationDesignMd(app);
mountPutOrganizationDesignMd(app);

export default app;

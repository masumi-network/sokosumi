import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountDeleteCoworkerAssignment from "./[id]/coworkers/[coworkerId]/assignments/[userId]/delete.js";
import mountListCoworkerAssignments from "./[id]/coworkers/[coworkerId]/assignments/get.js";
import mountPutCoworkerAssignment from "./[id]/coworkers/[coworkerId]/assignments/put.js";
import mountListVendorMembers from "./[id]/members/get.js";
import mountPatchVendor from "./[id]/patch.js";
import mountListVendors from "./get.js";
import mountListMyVendorMemberships from "./me/get.js";

const app = new OpenAPIHonoWithAuth();

mountListVendors(app);
mountListMyVendorMemberships(app);
mountPatchVendor(app);
mountListVendorMembers(app);
mountListCoworkerAssignments(app);
mountPutCoworkerAssignment(app);
mountDeleteCoworkerAssignment(app);

export default app;

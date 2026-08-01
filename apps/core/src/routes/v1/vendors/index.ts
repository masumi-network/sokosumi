import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountDeleteCoworkerAssignment from "./[id]/coworkers/[coworkerId]/assignments/[userId]/delete.js";
import mountListCoworkerAssignments from "./[id]/coworkers/[coworkerId]/assignments/get.js";
import mountPutCoworkerAssignment from "./[id]/coworkers/[coworkerId]/assignments/put.js";
import mountCleanupVendorFiles from "./[id]/files/cleanup/post.js";
import mountPostVendorFiles from "./[id]/files/post.js";
import mountRemoveVendorMember from "./[id]/members/[userId]/delete.js";
import mountPatchVendorMemberRole from "./[id]/members/[userId]/patch.js";
import mountListVendorMembers from "./[id]/members/get.js";
import mountAddVendorMember from "./[id]/members/post.js";
import mountPatchVendor from "./[id]/patch.js";
import mountListVendors from "./get.js";
import mountListMyVendorMemberships from "./me/get.js";

const app = new OpenAPIHonoWithAuth();

mountListVendors(app);
mountListMyVendorMemberships(app);
mountPatchVendor(app);
mountListVendorMembers(app);
mountAddVendorMember(app);
mountPatchVendorMemberRole(app);
mountRemoveVendorMember(app);
mountListCoworkerAssignments(app);
mountPutCoworkerAssignment(app);
mountDeleteCoworkerAssignment(app);
// Static `/{id}/files/cleanup` before `/{id}/files` is fine; both are exact paths.
mountCleanupVendorFiles(app);
mountPostVendorFiles(app);

export default app;

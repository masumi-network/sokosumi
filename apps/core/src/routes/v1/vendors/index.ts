import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountDeleteCoworkerAssignment from "./[id]/coworkers/[coworkerId]/assignments/[userId]/delete.js";
import mountListCoworkerAssignments from "./[id]/coworkers/[coworkerId]/assignments/get.js";
import mountPutCoworkerAssignment from "./[id]/coworkers/[coworkerId]/assignments/put.js";
import mountCleanupVendorFiles from "./[id]/files/cleanup/post.js";
import mountPostVendorFiles from "./[id]/files/post.js";
import mountRevokeVendorInvite from "./[id]/invites/[inviteId]/delete.js";
import mountListVendorInvites from "./[id]/invites/get.js";
import mountCreateVendorInvite from "./[id]/invites/post.js";
import mountRemoveVendorMember from "./[id]/members/[userId]/delete.js";
import mountPatchVendorMemberRole from "./[id]/members/[userId]/patch.js";
import mountListVendorMembers from "./[id]/members/get.js";
import mountPatchVendor from "./[id]/patch.js";
import mountListVendors from "./get.js";
import mountAcceptVendorInvite from "./invites/[inviteId]/accept/post.js";
import mountDeclineVendorInvite from "./invites/[inviteId]/decline/post.js";
import mountListMyVendorInvites from "./invites/get.js";
import mountListMyVendorMemberships from "./me/get.js";
import mountCreateVendor from "./post.js";

const app = new OpenAPIHonoWithAuth();

mountListVendors(app);
mountCreateVendor(app);
mountListMyVendorMemberships(app);
// Static `/invites` routes before the `/{id}/…` param routes.
mountListMyVendorInvites(app);
mountAcceptVendorInvite(app);
mountDeclineVendorInvite(app);
mountPatchVendor(app);
mountListVendorMembers(app);
mountCreateVendorInvite(app);
mountListVendorInvites(app);
mountRevokeVendorInvite(app);
mountPatchVendorMemberRole(app);
mountRemoveVendorMember(app);
mountListCoworkerAssignments(app);
mountPutCoworkerAssignment(app);
mountDeleteCoworkerAssignment(app);
// Static `/{id}/files/cleanup` before `/{id}/files` is fine; both are exact paths.
mountCleanupVendorFiles(app);
mountPostVendorFiles(app);

export default app;

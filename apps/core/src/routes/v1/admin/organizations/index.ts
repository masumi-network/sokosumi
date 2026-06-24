import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountGetAdminOrganizationBySlug from "./[slug]/get.js";
import mountRemoveAdminOrganizationMember from "./[slug]/members/[memberId]/delete.js";
import mountUpdateAdminOrganizationMemberRole from "./[slug]/members/[memberId]/role/patch.js";
import mountUnassignAdminOrganizationMemberSeat from "./[slug]/members/[memberId]/seat/delete.js";
import mountAssignAdminOrganizationMemberSeat from "./[slug]/members/[memberId]/seat/put.js";
import mountListAdminOrganizationMembers from "./[slug]/members/get.js";
import mountAddAdminOrganizationMember from "./[slug]/members/post.js";
import mountListAdminOrganizations from "./get.js";

const app = new OpenAPIHonoWithAuth();

mountListAdminOrganizations(app);
mountGetAdminOrganizationBySlug(app);
mountListAdminOrganizationMembers(app);
mountAddAdminOrganizationMember(app);
mountRemoveAdminOrganizationMember(app);
mountUpdateAdminOrganizationMemberRole(app);
mountAssignAdminOrganizationMemberSeat(app);
mountUnassignAdminOrganizationMemberSeat(app);

export default app;

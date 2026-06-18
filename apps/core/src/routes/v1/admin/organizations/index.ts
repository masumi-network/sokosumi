import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountGetAdminOrganizationBySlug from "./[slug]/get.js";
import mountRemoveAdminOrganizationMember from "./[slug]/members/[memberId]/delete.js";
import mountUpdateAdminOrganizationMemberRole from "./[slug]/members/[memberId]/role/patch.js";
import mountUnassignAdminOrganizationMemberSeat from "./[slug]/members/[memberId]/seat/delete.js";
import mountAssignAdminOrganizationMemberSeat from "./[slug]/members/[memberId]/seat/put.js";
import mountListAdminOrganizationMemberOverview from "./[slug]/members/overview/get.js";
import mountAddAdminOrganizationMember from "./[slug]/members/post.js";
import mountGetAdminOrganizationOverviewBySlug from "./[slug]/overview/get.js";
import mountSearchAdminOrganizations from "./get.js";
import mountListAdminOrganizationOverview from "./overview/get.js";

const app = new OpenAPIHonoWithAuth();

mountListAdminOrganizationOverview(app);
mountSearchAdminOrganizations(app);
mountGetAdminOrganizationOverviewBySlug(app);
mountListAdminOrganizationMemberOverview(app);
mountAddAdminOrganizationMember(app);
mountRemoveAdminOrganizationMember(app);
mountUpdateAdminOrganizationMemberRole(app);
mountAssignAdminOrganizationMemberSeat(app);
mountUnassignAdminOrganizationMemberSeat(app);
mountGetAdminOrganizationBySlug(app);

export default app;

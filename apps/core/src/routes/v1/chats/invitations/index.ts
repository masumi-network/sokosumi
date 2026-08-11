import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountAcceptInviteeInvitation from "./[id]/accept/post.js";
import mountDeclineInviteeInvitation from "./[id]/decline/post.js";
import mountGetInviteeInvitation from "./[id]/get.js";
import mountListInviteeInvitations from "./get.js";

const app = new OpenAPIHonoWithAuth();

// Static collection before `/{id}`.
mountListInviteeInvitations(app);
mountGetInviteeInvitation(app);
mountAcceptInviteeInvitation(app);
mountDeclineInviteeInvitation(app);

export default app;

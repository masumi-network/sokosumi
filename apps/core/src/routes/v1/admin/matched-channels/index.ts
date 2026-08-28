import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountGetAdminMatchedChannel from "./[roomId]/get.js";
import mountRemoveAdminMatchedChannelParticipant from "./[roomId]/participants/[userId]/delete.js";
import mountAddAdminMatchedChannelParticipantsFromOrganization from "./[roomId]/participants/from-organization/post.js";
import mountAddAdminMatchedChannelParticipant from "./[roomId]/participants/post.js";
import mountListAdminMatchedChannels from "./get.js";
import mountCreateAdminMatchedChannel from "./post.js";

const app = new OpenAPIHonoWithAuth();

mountListAdminMatchedChannels(app);
mountCreateAdminMatchedChannel(app);
mountGetAdminMatchedChannel(app);
mountAddAdminMatchedChannelParticipantsFromOrganization(app);
mountAddAdminMatchedChannelParticipant(app);
mountRemoveAdminMatchedChannelParticipant(app);

export default app;

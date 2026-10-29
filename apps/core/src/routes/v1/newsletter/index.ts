import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetAvailability from "./availability/get.js";
import mountPostSendingDomainCheck from "./sending-domain/check/post.js";
import mountPostSendingDomainCloudflare from "./sending-domain/cloudflare/post.js";
import mountDeleteSendingDomain from "./sending-domain/delete.js";
import mountGetSendingDomainConnect from "./sending-domain/domain-connect/get.js";
import mountGetSendingDomain from "./sending-domain/get.js";
import mountPutSendingDomain from "./sending-domain/put.js";

const app = new OpenAPIHonoWithAuth({ includeWorkspaceContext: true });

mountGetAvailability(app);
mountGetSendingDomain(app);
mountPutSendingDomain(app);
mountDeleteSendingDomain(app);
mountPostSendingDomainCheck(app);
mountPostSendingDomainCloudflare(app);
mountGetSendingDomainConnect(app);

export default app;

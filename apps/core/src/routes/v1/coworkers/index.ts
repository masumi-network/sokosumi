import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetCoworkerEvents from "./[id]/events/get.js";
import mountGetCoworkerById from "./[id]/get.js";
import mountPostCoworkerUsage from "./[id]/usage/post.js";
import mountGetCoworkers from "./get.js";

const app = new OpenAPIHonoWithAuth();

mountGetCoworkers(app);
mountGetCoworkerById(app);
mountGetCoworkerEvents(app);
mountPostCoworkerUsage(app);

export default app;

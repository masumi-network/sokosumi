import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetCoworkerEvents from "./[id]/events/get.js";
import mountGetCoworkerById from "./[id]/get.js";
import mountPostCoworkerUsage from "./[id]/usage/post.js";
import mountGetCoworkers from "./get.js";
import mountGetCoworkerMeEvents from "./me/events/get.js";
import mountGetCoworkerMe from "./me/get.js";
import mountPostCoworkerMeUsage from "./me/usage/post.js";

const app = new OpenAPIHonoWithAuth();

mountGetCoworkers(app);
mountGetCoworkerMe(app);
mountGetCoworkerMeEvents(app);
mountPostCoworkerMeUsage(app);
mountGetCoworkerById(app);
mountGetCoworkerEvents(app);
mountPostCoworkerUsage(app);

export default app;

import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetCoworkerById from "./[id]/get.js";
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

export default app;

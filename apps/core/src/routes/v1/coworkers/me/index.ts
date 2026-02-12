import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetCoworkerMeEvents from "./events/get.js";
import mountGetCoworkerMe from "./get.js";
import mountPostCoworkerMeUsage from "./usage/post.js";

const app = new OpenAPIHonoWithAuth();

mountGetCoworkerMe(app);
mountGetCoworkerMeEvents(app);
mountPostCoworkerMeUsage(app);

export default app;

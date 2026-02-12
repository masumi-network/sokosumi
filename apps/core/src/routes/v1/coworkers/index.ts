import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetCoworkerEvents from "./[id]/events/get.js";
import mountGetCoworkerById from "./[id]/get.js";
import mountPostCoworkerUsage from "./[id]/usage/post.js";
import mountGetCoworkers from "./get.js";
import coworkersMeRouter from "./me/index.js";

const app = new OpenAPIHonoWithAuth();

mountGetCoworkers(app);
app.route("/me", coworkersMeRouter);
mountGetCoworkerById(app);
mountGetCoworkerEvents(app);
mountPostCoworkerUsage(app);

export default app;

import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetCoworkerById from "./[id]/get.js";
import mountGetCoworkers from "./get.js";
import coworkersMeRouter from "./me/index.js";

const app = new OpenAPIHonoWithAuth();

mountGetCoworkers(app);
app.route("/me", coworkersMeRouter);
mountGetCoworkerById(app);

export default app;

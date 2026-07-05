import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountResolveCoworkerGrant from "./[id]/patch.js";
import mountGetCoworkerGrants from "./get.js";

const app = new OpenAPIHonoWithAuth();

mountGetCoworkerGrants(app);
mountResolveCoworkerGrant(app);

export default app;

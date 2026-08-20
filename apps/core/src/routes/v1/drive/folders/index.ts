import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountDeleteFolder from "./delete.js";
import mountPostFolder from "./post.js";
import mountRenameFolder from "./rename.js";

const app = new OpenAPIHonoWithAuth();

mountPostFolder(app);
mountDeleteFolder(app);
mountRenameFolder(app);

export default app;

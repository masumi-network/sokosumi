import { createNestedOpenAPIHono } from "@/lib/hono";
import mountDeleteFolder from "./delete.js";
import mountPostFolder from "./post.js";
import mountRenameFolder from "./rename.js";

const app = createNestedOpenAPIHono();

mountPostFolder(app);
mountDeleteFolder(app);
mountRenameFolder(app);

export default app;

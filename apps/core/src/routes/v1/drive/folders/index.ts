import { createNestedOpenAPIHono } from "@/lib/hono";
import mountDeleteFolder from "./delete.js";
import mountGetFolders from "./get.js";
import mountPostFolder from "./post.js";
import mountRenameFolder from "./rename.js";

const app = createNestedOpenAPIHono();

mountGetFolders(app);
mountPostFolder(app);
mountDeleteFolder(app);
mountRenameFolder(app);

export default app;

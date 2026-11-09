import { createNestedOpenAPIHono } from "@/lib/hono";

import mountDelete from "./[id]/delete.js";
import mountEvents from "./[id]/events.js";
import mountGetOne from "./[id]/get.js";
import mountDeleteMember from "./[id]/members/[memberId]/delete.js";
import mountPatchMember from "./[id]/members/[memberId]/patch.js";
import mountInvite from "./[id]/members/post.js";
import mountOrder from "./[id]/order.js";
import mountPatch from "./[id]/patch.js";
import mountAnswer from "./[id]/questions/[questionId]/patch.js";
import mountQuestions from "./[id]/questions/get.js";
import mountGet from "./get.js";
import mountPost from "./post.js";

const app = createNestedOpenAPIHono();

mountGet(app);
mountPost(app);
mountGetOne(app);
mountPatch(app);
mountDelete(app);
mountInvite(app);
mountPatchMember(app);
mountDeleteMember(app);
mountEvents(app);
mountQuestions(app);
mountAnswer(app);
mountOrder(app);

export default app;

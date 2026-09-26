import type { Hono } from "hono";
import { classifyPendingTaskTags } from "@/services/task-tag-classification.service";
import { handleSyncRequest } from "../handler";
export default function mount(app: Hono) {
  app.get("/task-tags", (c) =>
    handleSyncRequest(c, "task-tag-classification", classifyPendingTaskTags),
  );
}

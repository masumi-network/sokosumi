"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentSchema = void 0;
var zod_openapi_1 = require("@hono/zod-openapi");
exports.agentSchema = zod_openapi_1.z
    .object({
    id: zod_openapi_1.z.string().openapi({ example: "agent_123" }),
    name: zod_openapi_1.z.string().openapi({ example: "Research Assistant" }),
})
    .openapi("Agent");

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userSchema = void 0;
var zod_openapi_1 = require("@hono/zod-openapi");
exports.userSchema = zod_openapi_1.z
    .object({
    id: zod_openapi_1.z.string().openapi({ example: "0Lm1hpg77w8g8QXbr3aEsFzX9aIUTybj" }),
    name: zod_openapi_1.z.string().openapi({ example: "John Doe" }),
    email: zod_openapi_1.z.string().openapi({ example: "john.doe@example.com" }),
})
    .openapi("User");

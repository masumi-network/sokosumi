"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.created = exports.ok = exports.successResponseSchema = void 0;
var zod_openapi_1 = require("@hono/zod-openapi");
/**
 * Standardized API success response schema
 * Provides consistent success structure across all API endpoints
 */
var successResponseSchema = function (dataSchema) {
    return zod_openapi_1.z
        .object({
        /** The actual response data */
        data: dataSchema,
        /** Metadata about the response */
        meta: zod_openapi_1.z.object({
            /** ISO timestamp when the response was generated */
            timestamp: zod_openapi_1.z.iso.datetime(),
            // .openapi({ example: "2025-01-01T12:00:00.000Z" }),
            // Room for future additions: pagination, requestId, version, etc.
            requestId: zod_openapi_1.z
                .string()
                .openapi({ example: "5091b3ea-994f-4417-8e04-2efc05dd8673" }),
        }),
    })
        .openapi("SuccessResponse");
};
exports.successResponseSchema = successResponseSchema;
var ok = function (c, data) {
    return c.json({
        data: data,
        meta: {
            timestamp: new Date().toISOString(),
            requestId: c.var.requestId,
        },
    }, 200);
};
exports.ok = ok;
var created = function (c, data) {
    return c.json({
        data: data,
        meta: {
            timestamp: new Date().toISOString(),
            requestId: c.var.requestId,
        },
    }, 201);
};
exports.created = created;

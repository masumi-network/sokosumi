"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serviceUnavailable = exports.internalServerError = exports.tooManyRequests = exports.unprocessableEntity = exports.conflict = exports.notFound = exports.forbidden = exports.unauthorized = exports.badRequest = exports.errorResponseSchema = void 0;
exports.getErrorName = getErrorName;
var zod_openapi_1 = require("@hono/zod-openapi");
var http_exception_1 = require("hono/http-exception");
/**
 * Standardized API error response schema
 * Mirrors success response structure for consistency
 */
exports.errorResponseSchema = zod_openapi_1.z
    .object({
    /** Machine-readable error identifier */
    error: zod_openapi_1.z.string().openapi({ example: "Unauthorized" }),
    /** Human-readable description of the error */
    message: zod_openapi_1.z.string().openapi({ example: "Authentication required" }),
    /** Metadata about the request and response */
    meta: zod_openapi_1.z.object({
        /** ISO timestamp when the error was generated */
        timestamp: zod_openapi_1.z.iso
            .datetime()
            .openapi({ example: "2025-01-01T12:00:00.000Z" }),
        requestId: zod_openapi_1.z
            .string()
            .openapi({ example: "5091b3ea-994f-4417-8e04-2efc05dd8673" }),
        path: zod_openapi_1.z.string().openapi({ example: "/v1/agents" }),
        method: zod_openapi_1.z.string().openapi({ example: "GET" }),
    }),
})
    .openapi("ErrorResponse");
/**
 * Helper to create HTTPException with options stored in cause
 */
function createHTTPException(status, message) {
    return new http_exception_1.HTTPException(status, { message: message });
}
/**
 * 400 Bad Request
 * The server cannot process the request due to client error
 */
var badRequest = function (message) {
    if (message === void 0) { message = "Bad Request"; }
    return createHTTPException(400, message);
};
exports.badRequest = badRequest;
/**
 * 401 Unauthorized
 * Authentication is required and has failed or has not been provided
 */
var unauthorized = function (message) {
    if (message === void 0) { message = "Unauthorized"; }
    return createHTTPException(401, message);
};
exports.unauthorized = unauthorized;
/**
 * 403 Forbidden
 * The client does not have access rights to the content
 */
var forbidden = function (message) {
    if (message === void 0) { message = "Forbidden"; }
    return createHTTPException(403, message);
};
exports.forbidden = forbidden;
/**
 * 404 Not Found
 * The server cannot find the requested resource
 */
var notFound = function (message) {
    if (message === void 0) { message = "Not Found"; }
    return createHTTPException(404, message);
};
exports.notFound = notFound;
/**
 * 409 Conflict
 * The request conflicts with the current state of the server
 */
var conflict = function (message) {
    if (message === void 0) { message = "Conflict"; }
    return createHTTPException(409, message);
};
exports.conflict = conflict;
/**
 * 422 Unprocessable Entity
 * The request was well-formed but was unable to be followed due to semantic errors
 */
var unprocessableEntity = function (message) {
    if (message === void 0) { message = "Unprocessable Entity"; }
    return createHTTPException(422, message);
};
exports.unprocessableEntity = unprocessableEntity;
/**
 * 429 Too Many Requests
 * The user has sent too many requests in a given amount of time
 */
var tooManyRequests = function (message) {
    if (message === void 0) { message = "Too Many Requests"; }
    return createHTTPException(429, message);
};
exports.tooManyRequests = tooManyRequests;
/**
 * 500 Internal Server Error
 * The server encountered an unexpected condition that prevented it from fulfilling the request
 */
var internalServerError = function (message) {
    if (message === void 0) { message = "Internal Server Error"; }
    return createHTTPException(500, message);
};
exports.internalServerError = internalServerError;
/**
 * 503 Service Unavailable
 * The server is not ready to handle the request
 */
var serviceUnavailable = function (message) {
    if (message === void 0) { message = "Service Unavailable"; }
    return createHTTPException(503, message);
};
exports.serviceUnavailable = serviceUnavailable;
/**
 * Helper for onError handler to get error name from status code
 */
function getErrorName(status) {
    var errorNames = {
        400: "BadRequest",
        401: "Unauthorized",
        403: "Forbidden",
        404: "NotFound",
        409: "Conflict",
        422: "UnprocessableEntity",
        429: "TooManyRequests",
        500: "InternalServerError",
        503: "ServiceUnavailable",
    };
    return errorNames[status] || "Error";
}

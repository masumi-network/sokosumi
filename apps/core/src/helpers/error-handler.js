"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
var http_exception_1 = require("hono/http-exception");
var error_1 = require("./error");
/**
 * Centralized error handler for Hono app
 * Formats HTTPExceptions into consistent error responses
 */
function errorHandler(error, c) {
    var meta = {
        timestamp: new Date().toISOString(),
        requestId: c.var.requestId,
        path: c.req.path,
        method: c.req.method,
    };
    if (error instanceof http_exception_1.HTTPException) {
        var status_1 = error.status;
        var errorResponse = {
            error: (0, error_1.getErrorName)(status_1),
            message: error.message,
            meta: meta,
        };
        return c.json(errorResponse, status_1);
    }
    // Handle unexpected errors
    return c.json({
        error: "InternalServerError",
        message: "An unexpected error occurred",
        meta: meta,
    }, 500);
}

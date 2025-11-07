"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var swagger_ui_1 = require("@hono/swagger-ui");
var zod_openapi_1 = require("@hono/zod-openapi");
var error_handler_1 = require("@/helpers/error-handler");
var env_1 = require("../../config/env");
var agents_1 = require("./agents");
var users_1 = require("./users");
var app = new zod_openapi_1.OpenAPIHono();
app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
});
app.onError(error_handler_1.errorHandler);
// Mount Routes
app.route("/agents", agents_1.default);
app.route("/users", users_1.default);
// Generate OpenAPI spec from the API routes (publicly accessible)
app.doc("/openapi.json", {
    openapi: "3.0.3",
    info: {
        version: "1.0.0",
        title: "Sokosumi API",
    },
    servers: [
        {
            url: "http://localhost:".concat(env_1.env.PORT, "/v1"),
            description: "Local Server",
        },
    ],
    security: [{ bearerAuth: [] }],
});
app.get("/doc", (0, swagger_ui_1.swaggerUI)({
    url: "openapi.json",
    persistAuthorization: true,
    withCredentials: true,
    tryItOutEnabled: true,
}));
exports.default = app;

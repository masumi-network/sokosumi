"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
var hono_1 = require("hono");
var cors_1 = require("hono/cors");
var logger_1 = require("hono/logger");
var request_id_1 = require("hono/request-id");
var env_1 = require("./config/env");
var error_1 = require("./helpers/error");
var v1_1 = require("./routes/v1");
var app = new hono_1.Hono();
app.use((0, logger_1.logger)());
app.use((0, request_id_1.requestId)());
app.use("*", (0, cors_1.cors)());
app.notFound(function () {
    throw (0, error_1.notFound)();
});
// Mount API v1 routes
app.route("/v1", v1_1.default);
exports.default = {
    port: (_a = env_1.env.PORT) !== null && _a !== void 0 ? _a : 3000,
    fetch: app.fetch,
};

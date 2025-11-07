"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var hono_1 = require("@/lib/hono");
var get_1 = require("./[id]/get");
var get_2 = require("./get");
var app = new hono_1.OpenAPIHonoWithAuth();
(0, get_2.default)(app);
(0, get_1.default)(app);
exports.default = app;

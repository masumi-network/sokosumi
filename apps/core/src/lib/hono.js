"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAPIHonoWithAuth = exports.HonoWithAuth = void 0;
var zod_openapi_1 = require("@hono/zod-openapi");
var hono_1 = require("hono");
var request_id_1 = require("hono/request-id");
var auth_1 = require("../middleware/auth");
/**
 * Type-safe Hono class with AuthContext in Variables
 * Use this for routes that require authentication
 *
 * Auth middleware is automatically applied - all routes are protected
 * For mixed public/private routes, use standard Hono class instead
 *
 * @example
 * const router = new HonoWithAuth();
 * // requireAuth middleware is already applied
 */
var HonoWithAuth = /** @class */ (function (_super) {
    __extends(HonoWithAuth, _super);
    function HonoWithAuth() {
        var _this = _super.call(this) || this;
        _this.use((0, request_id_1.requestId)());
        _this.use(auth_1.authMiddleware);
        return _this;
    }
    return HonoWithAuth;
}(hono_1.Hono));
exports.HonoWithAuth = HonoWithAuth;
/**
 * Type-safe OpenAPIHono class with AuthContext in Variables
 * Use this for OpenAPI routes that require authentication
 *
 * Auth middleware is automatically applied - all routes are protected
 * For mixed public/private routes, use standard OpenAPIHono class instead
 *
 * @example
 * const app = new OpenAPIHonoWithAuth();
 * // requireAuth middleware is already applied
 */
var OpenAPIHonoWithAuth = /** @class */ (function (_super) {
    __extends(OpenAPIHonoWithAuth, _super);
    function OpenAPIHonoWithAuth() {
        var _this = _super.call(this) || this;
        _this.use((0, request_id_1.requestId)());
        _this.use(auth_1.authMiddleware);
        return _this;
    }
    return OpenAPIHonoWithAuth;
}(zod_openapi_1.OpenAPIHono));
exports.OpenAPIHonoWithAuth = OpenAPIHonoWithAuth;

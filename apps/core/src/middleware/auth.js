"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = void 0;
var bearer_auth_1 = require("hono/bearer-auth");
var env_1 = require("../config/env");
var error_1 = require("../helpers/error");
var auth_1 = require("../lib/auth");
function setAuthContext(c, context) {
    c.set("isAuthenticated", context.isAuthenticated);
    c.set("user", context.user);
}
var bearerMiddleware = (0, bearer_auth_1.bearerAuth)({
    verifyToken: function (token, c) { return __awaiter(void 0, void 0, void 0, function () {
        var result;
        var _a, _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    // Check 1: Static API_KEY (internal service)
                    if (token === env_1.env.API_KEY) {
                        setAuthContext(c, { isAuthenticated: true, user: undefined });
                        return [2 /*return*/, true];
                    }
                    return [4 /*yield*/, auth_1.auth.api.verifyApiKey({
                            body: { key: token },
                        })];
                case 1:
                    result = _c.sent();
                    if (result.valid && result.key) {
                        setAuthContext(c, {
                            isAuthenticated: true,
                            user: {
                                id: result.key.userId,
                                organizationId: (_b = (_a = result.key.metadata) === null || _a === void 0 ? void 0 : _a.organizationId) !== null && _b !== void 0 ? _b : null,
                            },
                        });
                        return [2 /*return*/, true];
                    }
                    throw (0, error_1.unauthorized)("Invalid token");
            }
        });
    }); },
});
var sessionMiddleware = function (c, next) { return __awaiter(void 0, void 0, void 0, function () {
    var response, session, user;
    var _a;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0: return [4 /*yield*/, auth_1.auth.api.getSession({
                    headers: c.req.raw.headers,
                })];
            case 1:
                response = _b.sent();
                if (!((response === null || response === void 0 ? void 0 : response.session) && response.user)) return [3 /*break*/, 3];
                session = response.session, user = response.user;
                setAuthContext(c, {
                    isAuthenticated: true,
                    user: {
                        id: user.id,
                        organizationId: (_a = session.activeOrganizationId) !== null && _a !== void 0 ? _a : null,
                    },
                });
                return [4 /*yield*/, next()];
            case 2:
                _b.sent();
                _b.label = 3;
            case 3: throw (0, error_1.unauthorized)();
        }
    });
}); };
var authMiddleware = function (c, next) { return __awaiter(void 0, void 0, void 0, function () {
    var authHeader;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                authHeader = c.req.header("authorization");
                if (!authHeader) return [3 /*break*/, 2];
                return [4 /*yield*/, bearerMiddleware(c, next)];
            case 1:
                _a.sent();
                return [3 /*break*/, 4];
            case 2: return [4 /*yield*/, sessionMiddleware(c, next)];
            case 3:
                _a.sent();
                _a.label = 4;
            case 4: return [2 /*return*/];
        }
    });
}); };
exports.authMiddleware = authMiddleware;

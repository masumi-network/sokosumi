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
exports.default = mount;
var zod_openapi_1 = require("@hono/zod-openapi");
var repositories_1 = require("@sokosumi/database/repositories");
var error_1 = require("@/helpers/error");
var openapi_1 = require("@/helpers/openapi");
var response_1 = require("@/helpers/response");
var schemas_1 = require("../schemas");
var params = zod_openapi_1.z.object({
    id: zod_openapi_1.z.string().openapi({
        param: { name: "id", in: "path" },
        example: "cmaeygqwa000e8i0s9s7wif8i",
    }),
});
var route = (0, zod_openapi_1.createRoute)({
    method: "get",
    path: "/{id}",
    tags: ["Agents"],
    request: {
        params: params,
    },
    responses: {
        200: (0, openapi_1.jsonSuccessResponse)(schemas_1.agentSchema, "Retrieve the agent by ID"),
        401: (0, openapi_1.jsonErrorResponse)("Unauthorized"),
        404: (0, openapi_1.jsonErrorResponse)("Not Found"),
    },
});
function mount(app) {
    var _this = this;
    app.openapi(route, function (c) { return __awaiter(_this, void 0, void 0, function () {
        var id, data;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    id = c.req.valid("param").id;
                    return [4 /*yield*/, repositories_1.agentRepository.getAgentWithRelationsById(id)];
                case 1:
                    data = _a.sent();
                    if (!data) {
                        throw (0, error_1.notFound)("Agent not found");
                    }
                    return [2 /*return*/, (0, response_1.ok)(c, schemas_1.agentSchema.parse(data))];
            }
        });
    }); });
}

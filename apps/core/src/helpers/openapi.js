"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.jsonContent = jsonContent;
exports.jsonSuccessResponse = jsonSuccessResponse;
exports.jsonErrorResponse = jsonErrorResponse;
var error_1 = require("./error");
var response_1 = require("./response");
function jsonContent(schema) {
    return {
        "application/json": {
            schema: schema,
        },
    };
}
function jsonSuccessResponse(schema, description) {
    return {
        description: description,
        content: jsonContent((0, response_1.successResponseSchema)(schema)),
    };
}
function jsonErrorResponse(description) {
    return {
        description: description,
        content: jsonContent(error_1.errorResponseSchema),
    };
}

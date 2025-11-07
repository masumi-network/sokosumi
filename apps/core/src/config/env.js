"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
function getEnv() {
    var port = parseInt(Bun.env.PORT || "3000", 10);
    var databaseUrl = Bun.env.DATABASE_URL;
    var apiKey = Bun.env.API_KEY;
    var betterAuthSecret = Bun.env.BETTER_AUTH_SECRET;
    var betterAuthUrl = Bun.env.BETTER_AUTH_URL || "http://localhost:".concat(port);
    var nodeEnv = (Bun.env.NODE_ENV || "development");
    if (!databaseUrl) {
        throw new Error("DATABASE_URL is required");
    }
    if (!apiKey) {
        throw new Error("API_KEY is required");
    }
    if (!betterAuthSecret) {
        throw new Error("BETTER_AUTH_SECRET is required");
    }
    return {
        PORT: port,
        DATABASE_URL: databaseUrl,
        API_KEY: apiKey,
        BETTER_AUTH_SECRET: betterAuthSecret,
        BETTER_AUTH_URL: betterAuthUrl,
        NODE_ENV: nodeEnv,
    };
}
exports.env = getEnv();

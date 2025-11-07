"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auth = void 0;
var client_1 = require("@sokosumi/database/client");
var better_auth_1 = require("better-auth");
var prisma_1 = require("better-auth/adapters/prisma");
var plugins_1 = require("better-auth/plugins");
var env_1 = require("../config/env");
exports.auth = (0, better_auth_1.betterAuth)({
    database: (0, prisma_1.prismaAdapter)(client_1.default, {
        provider: "postgresql",
    }),
    secret: env_1.env.BETTER_AUTH_SECRET,
    baseURL: env_1.env.BETTER_AUTH_URL,
    rateLimit: {
        storage: "database",
    },
    plugins: [
        (0, plugins_1.apiKey)({
            rateLimit: {
                enabled: true,
                timeWindow: 60, // 60 seconds
                maxRequests: 100, // 100 requests per minute
            },
            enableMetadata: true,
        }),
        (0, plugins_1.organization)({
            allowUserToCreateOrganization: function (user) {
                return user.emailVerified;
            },
            cancelPendingInvitationsOnReInvite: true,
            schema: {
                organization: {
                    additionalFields: {
                        stripeCustomerId: {
                            type: "string",
                            required: false,
                            defaultValue: null,
                            input: false,
                        },
                        invoiceEmail: {
                            type: "string",
                            required: false,
                            defaultValue: null,
                            input: false,
                        },
                    },
                },
            },
        }),
    ],
    user: {
        additionalFields: {
            termsAccepted: {
                type: "boolean",
                required: true,
                defaultValue: true,
            },
            marketingOptIn: {
                type: "boolean",
                required: true,
                defaultValue: true,
            },
            jobStatusNotificationsOptIn: {
                type: "boolean",
                required: false,
                defaultValue: true,
            },
            stripeCustomerId: {
                type: "string",
                required: false,
                defaultValue: null,
            },
            onboardingCompleted: {
                type: "boolean",
                required: true,
                defaultValue: false,
            },
            imageHash: {
                type: "string",
                required: false,
            },
        },
    },
});

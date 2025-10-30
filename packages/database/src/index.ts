// Re-export all Prisma types and enums from the generated ESM-first client
// This uses the browser-safe export to avoid Node.js dependencies in client components
// The prisma singleton should be imported from "@sokosumi/database/client"

// Export browser-safe types (includes Prisma namespace, model types, and all enums - no PrismaClient)
export * from "./generated/prisma/browser";

// Export additional model-related types
export * from "./generated/prisma/models";

// Export shared types
export * from "./types/utm";

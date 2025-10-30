/**
 * Backward compatibility re-export for runtime library types
 * These types are now available through the Prisma namespace
 *
 * @deprecated Import from "@sokosumi/database" and use Prisma.JsonValue or Prisma.InputJsonValue instead
 */

import { Prisma } from "../generated/prisma/browser";

export type JsonValue = Prisma.JsonValue;
export type InputJsonValue = Prisma.InputJsonValue;
export type JsonObject = Prisma.JsonObject;
export type JsonArray = Prisma.JsonArray;
export type InputJsonObject = Prisma.InputJsonObject;
export type InputJsonArray = Prisma.InputJsonArray;

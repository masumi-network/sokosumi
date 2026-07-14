import { z } from "@hono/zod-openapi";
import { VendorGrantStatus } from "@sokosumi/database";

import { dateTimeSchema } from "@/helpers/datetime.js";
import {
  VendorPermissionApi,
  type VendorPermissionApiValue,
} from "@/helpers/vendor-grants";

export const vendorPermissionSchema = z
  .enum([
    VendorPermissionApi.TASK_READ,
    VendorPermissionApi.TASK_COMMENT,
    VendorPermissionApi.TASK_CREATE,
  ])
  .openapi({ example: VendorPermissionApi.TASK_READ });

export type VendorPermissionSchema = z.infer<typeof vendorPermissionSchema>;

export const vendorGrantStatusSchema = z
  .enum(VendorGrantStatus)
  .openapi({ example: VendorGrantStatus.PENDING });

export const vendorGrantSchema = z
  .object({
    id: z
      .string()
      .uuid()
      .openapi({ example: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    vendorId: z.string().uuid(),
    vendorName: z.string().openapi({ example: "Acme Agents" }),
    vendorSlug: z.string().openapi({ example: "acme-agents" }),
    workspaceId: z.string().uuid(),
    permission: vendorPermissionSchema,
    status: vendorGrantStatusSchema,
    requestedByUserId: z.string().nullable(),
    resolvedAt: dateTimeSchema.nullable(),
    resolvedById: z.string().nullable(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("VendorGrant");

export const vendorGrantsSchema = z.array(vendorGrantSchema);

export const createVendorGrantRequestSchema = z.object({
  vendorId: z.string().uuid(),
  permission: vendorPermissionSchema,
});

export function isVendorPermissionApiValue(
  value: string,
): value is VendorPermissionApiValue {
  return (
    value === VendorPermissionApi.TASK_READ ||
    value === VendorPermissionApi.TASK_COMMENT ||
    value === VendorPermissionApi.TASK_CREATE
  );
}

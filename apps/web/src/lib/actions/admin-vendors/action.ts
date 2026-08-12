"use server";

import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import type { Vendor } from "@/lib/clients/generated/core";
import { adminVendorService } from "@/lib/services/admin-vendor.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const vendorIdSchema = z.string().min(1);

const createVendorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  logos: z
    .object({
      light: z.string().nullable().optional(),
      dark: z.string().nullable().optional(),
    })
    .optional(),
});

const patchVendorSchema = z.object({
  vendorId: vendorIdSchema,
  name: z.string().trim().min(1).max(120).optional(),
  logos: z
    .object({
      light: z.string().nullable().optional(),
      dark: z.string().nullable().optional(),
    })
    .optional(),
  current: z.object({
    name: z.string(),
    logos: z.object({
      light: z.string().nullable(),
      dark: z.string().nullable(),
    }),
  }),
});

function revalidateAdminVendorRoutes(vendorId?: string) {
  revalidatePath("/admin/vendors");
  if (vendorId) {
    revalidatePath(`/admin/vendors/${vendorId}`);
  }
}

function toAdminActionError(error: unknown): ActionError {
  if (isAdminAccessRequiredError(error)) {
    return {
      code: CommonErrorCode.UNAUTHORIZED,
      message: "Admin access required",
    };
  }
  return toCoreApiActionError(error);
}

interface CreateAdminVendorParameters extends AuthenticatedRequest {
  input: unknown;
}

export const createAdminVendorAction = withSession<
  CreateAdminVendorParameters,
  ActionResultDto<Vendor, ActionError>
>(async ({ input, session }) => {
  try {
    assertAdminSession(session);
    const parsed = createVendorSchema.safeParse(input);
    if (!parsed.success) {
      return toActionResult(
        err({
          code: CommonErrorCode.BAD_INPUT,
          message: "Invalid vendor input",
        }),
      );
    }

    const vendor = await adminVendorService.createVendor(parsed.data);
    revalidateAdminVendorRoutes(vendor.id);
    return toActionResult(ok(vendor));
  } catch (error) {
    return toActionResult(err(toAdminActionError(error)));
  }
});

interface PatchAdminVendorParameters extends AuthenticatedRequest {
  input: unknown;
}

export const patchAdminVendorAction = withSession<
  PatchAdminVendorParameters,
  ActionResultDto<Vendor, ActionError>
>(async ({ input, session }) => {
  try {
    assertAdminSession(session);
    const parsed = patchVendorSchema.safeParse(input);
    if (!parsed.success) {
      return toActionResult(
        err({
          code: CommonErrorCode.BAD_INPUT,
          message: "Invalid vendor profile input",
        }),
      );
    }

    const existing = await adminVendorService.getVendorById(
      parsed.data.vendorId,
    );
    if (!existing) {
      return toActionResult(
        err({
          code: CommonErrorCode.NOT_FOUND,
          message: "Vendor not found",
        }),
      );
    }

    const vendor = await adminVendorService.patchVendor(
      parsed.data.vendorId,
      {
        ...existing,
        name: parsed.data.current.name,
        logos: parsed.data.current.logos,
      },
      {
        name: parsed.data.name,
        logos: parsed.data.logos,
      },
    );

    revalidateAdminVendorRoutes(vendor.id);
    return toActionResult(ok(vendor));
  } catch (error) {
    return toActionResult(err(toAdminActionError(error)));
  }
});

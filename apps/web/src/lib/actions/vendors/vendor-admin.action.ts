"use server";

import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import type { Vendor } from "@/lib/clients/generated/core";
import { vendorService } from "@/lib/services/vendor.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const vendorIdSchema = z.string().min(1);

const patchVendorProfileSchema = z.object({
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

function revalidateDeveloperVendorRoutes(vendorId?: string) {
  revalidatePath("/developer/vendors");
  if (vendorId) {
    revalidatePath(`/developer/vendors/${vendorId}`);
  }
}

interface PatchVendorProfileParameters extends AuthenticatedRequest {
  input: unknown;
}

export const patchVendorProfileAction = withSession<
  PatchVendorProfileParameters,
  ActionResultDto<Vendor, ActionError>
>(async ({ input }) => {
  try {
    const parsed = patchVendorProfileSchema.safeParse(input);
    if (!parsed.success) {
      return toActionResult(
        err({
          code: CommonErrorCode.BAD_INPUT,
          message: "Invalid vendor profile input",
        }),
      );
    }

    const panelData = await vendorService.getVendorAdminPanelData(
      parsed.data.vendorId,
    );
    if (!panelData) {
      return toActionResult(
        err({
          code: CommonErrorCode.UNAUTHORIZED,
          message: "Vendor admin access required",
        }),
      );
    }

    const vendor = await vendorService.patchVendorProfile(
      parsed.data.vendorId,
      {
        id: parsed.data.vendorId,
        createdAt: panelData.vendor.createdAt,
        updatedAt: panelData.vendor.updatedAt,
        name: parsed.data.current.name,
        slug: panelData.vendor.slug,
        logos: parsed.data.current.logos,
      },
      {
        name: parsed.data.name,
        logos: parsed.data.logos,
      },
    );

    revalidateDeveloperVendorRoutes(parsed.data.vendorId);
    return toActionResult(ok(vendor));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

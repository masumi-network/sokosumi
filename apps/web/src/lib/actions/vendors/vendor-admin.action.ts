"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import type { CoworkerAssignment, Vendor } from "@/lib/clients/generated/core";
import {
  type VendorAdminPanelData,
  vendorService,
} from "@/lib/services/vendor.service";
import { Err, Ok, type Result } from "@/lib/ts-res";
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

const assignCoworkerDeveloperSchema = z.object({
  vendorId: vendorIdSchema,
  coworkerId: vendorIdSchema,
  userId: vendorIdSchema,
});

const unassignCoworkerDeveloperSchema = assignCoworkerDeveloperSchema;

function revalidateDeveloperVendorRoutes() {
  revalidatePath("/developer/vendors");
}

interface LoadVendorAdminPanelParameters extends AuthenticatedRequest {
  vendorId: unknown;
}

export const loadVendorAdminPanelAction = withSession<
  LoadVendorAdminPanelParameters,
  Result<VendorAdminPanelData, ActionError>
>(async ({ vendorId }) => {
  try {
    const parsedVendorId = vendorIdSchema.safeParse(vendorId);
    if (!parsedVendorId.success) {
      return Err({
        code: CommonErrorCode.BAD_INPUT,
        message: "Invalid vendor id",
      });
    }

    const data = await vendorService.getVendorAdminPanelData(
      parsedVendorId.data,
    );
    if (!data) {
      return Err({
        code: CommonErrorCode.UNAUTHORIZED,
        message: "Vendor admin access required",
      });
    }

    return Ok(data);
  } catch (error) {
    return Err(toCoreApiActionError(error));
  }
});

interface PatchVendorProfileParameters extends AuthenticatedRequest {
  input: unknown;
}

export const patchVendorProfileAction = withSession<
  PatchVendorProfileParameters,
  Result<Vendor, ActionError>
>(async ({ input }) => {
  try {
    const parsed = patchVendorProfileSchema.safeParse(input);
    if (!parsed.success) {
      return Err({
        code: CommonErrorCode.BAD_INPUT,
        message: "Invalid vendor profile input",
      });
    }

    const panelData = await vendorService.getVendorAdminPanelData(
      parsed.data.vendorId,
    );
    if (!panelData) {
      return Err({
        code: CommonErrorCode.UNAUTHORIZED,
        message: "Vendor admin access required",
      });
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

    revalidateDeveloperVendorRoutes();
    return Ok(vendor);
  } catch (error) {
    return Err(toCoreApiActionError(error));
  }
});

interface AssignCoworkerDeveloperParameters extends AuthenticatedRequest {
  input: unknown;
}

export const assignCoworkerDeveloperAction = withSession<
  AssignCoworkerDeveloperParameters,
  Result<CoworkerAssignment, ActionError>
>(async ({ input }) => {
  try {
    const parsed = assignCoworkerDeveloperSchema.safeParse(input);
    if (!parsed.success) {
      return Err({
        code: CommonErrorCode.BAD_INPUT,
        message: "Invalid assignment input",
      });
    }

    const panelData = await vendorService.getVendorAdminPanelData(
      parsed.data.vendorId,
    );
    if (!panelData) {
      return Err({
        code: CommonErrorCode.UNAUTHORIZED,
        message: "Vendor admin access required",
      });
    }

    const assignment = await vendorService.assignCoworkerDeveloper(
      parsed.data.vendorId,
      parsed.data.coworkerId,
      parsed.data.userId,
    );

    revalidateDeveloperVendorRoutes();
    return Ok(assignment);
  } catch (error) {
    return Err(toCoreApiActionError(error));
  }
});

interface UnassignCoworkerDeveloperParameters extends AuthenticatedRequest {
  input: unknown;
}

export const unassignCoworkerDeveloperAction = withSession<
  UnassignCoworkerDeveloperParameters,
  Result<{ success: true }, ActionError>
>(async ({ input }) => {
  try {
    const parsed = unassignCoworkerDeveloperSchema.safeParse(input);
    if (!parsed.success) {
      return Err({
        code: CommonErrorCode.BAD_INPUT,
        message: "Invalid unassignment input",
      });
    }

    const panelData = await vendorService.getVendorAdminPanelData(
      parsed.data.vendorId,
    );
    if (!panelData) {
      return Err({
        code: CommonErrorCode.UNAUTHORIZED,
        message: "Vendor admin access required",
      });
    }

    await vendorService.unassignCoworkerDeveloper(
      parsed.data.vendorId,
      parsed.data.coworkerId,
      parsed.data.userId,
    );

    revalidateDeveloperVendorRoutes();
    return Ok({ success: true });
  } catch (error) {
    return Err(toCoreApiActionError(error));
  }
});

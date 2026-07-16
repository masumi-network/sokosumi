import { type Vendor } from "@sokosumi/database";

import { vendorSchema } from "@/schemas/vendor.schema";

export function mapVendor(vendor: Vendor) {
  return vendorSchema.parse({
    id: vendor.id,
    createdAt: vendor.createdAt,
    updatedAt: vendor.updatedAt,
    name: vendor.name,
    slug: vendor.slug,
    logos: {
      light: vendor.logoLight,
      dark: vendor.logoDark,
    },
  });
}

export function vendorLogoCreateData(
  logos: { light?: string | null; dark?: string | null } | undefined,
): Pick<Vendor, "logoLight" | "logoDark"> {
  return {
    logoLight: logos?.light ?? null,
    logoDark: logos?.dark ?? null,
  };
}

export function vendorLogoPatchData(
  logos: { light?: string | null; dark?: string | null } | undefined,
): Partial<Pick<Vendor, "logoLight" | "logoDark">> {
  if (logos === undefined) {
    return {};
  }

  return {
    ...(logos.light !== undefined ? { logoLight: logos.light } : {}),
    ...(logos.dark !== undefined ? { logoDark: logos.dark } : {}),
  };
}

import "server-only";

import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type {
  CreateVendorRequest,
  PatchVendorRequest,
  Vendor,
} from "@/lib/clients/generated/core";

export const adminVendorService = (() => {
  async function listVendors(): Promise<Vendor[]> {
    const { data } = await coreClient.listAdminVendors();
    return data ?? [];
  }

  async function getVendorById(id: string): Promise<Vendor | null> {
    const vendors = await listVendors();
    return vendors.find((vendor) => vendor.id === id) ?? null;
  }

  async function createVendor(body: CreateVendorRequest): Promise<Vendor> {
    const { data } = await coreClient.createAdminVendor(body);
    if (!data) {
      throw new Error("Vendor create did not return data");
    }
    return data;
  }

  async function patchVendor(
    id: string,
    current: Vendor,
    updates: {
      name?: string;
      logos?: {
        light?: string | null;
        dark?: string | null;
      };
    },
  ): Promise<Vendor> {
    const body: PatchVendorRequest = {};

    if (updates.name !== undefined && updates.name !== current.name) {
      body.name = updates.name;
    }

    const logos: NonNullable<PatchVendorRequest["logos"]> = {};
    if (
      updates.logos?.light !== undefined &&
      updates.logos.light !== current.logos.light
    ) {
      logos.light = updates.logos.light;
    }
    if (
      updates.logos?.dark !== undefined &&
      updates.logos.dark !== current.logos.dark
    ) {
      logos.dark = updates.logos.dark;
    }
    if (Object.keys(logos).length > 0) {
      body.logos = logos;
    }

    if (Object.keys(body).length === 0) {
      return current;
    }

    try {
      const { data } = await coreClient.patchAdminVendor(id, body);
      if (!data) {
        throw new Error("Vendor update did not return data");
      }
      return data;
    } catch (error) {
      if (error instanceof CoreApiRequestError) {
        throw error;
      }
      throw error;
    }
  }

  return {
    listVendors,
    getVendorById,
    createVendor,
    patchVendor,
  };
})();

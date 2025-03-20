import { PricingType } from "@prisma/client";

export enum PricingTypeDTO {
  Fixed = "Fixed",
  Unknown = "Unknown",
}

export function createPricingTypeDTO(priceType: PricingType): PricingTypeDTO {
  switch (priceType) {
    case PricingType.Fixed:
      return PricingTypeDTO.Fixed;
    default:
      return PricingTypeDTO.Unknown;
  }
}

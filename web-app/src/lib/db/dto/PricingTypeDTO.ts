import { PricingType } from "@prisma/client";

export const PricingTypeDTO = {
  Fixed: "Fixed",
} as const;

export type PricingTypeDTO =
  (typeof PricingTypeDTO)[keyof typeof PricingTypeDTO];

export function createPricingTypeDTO(priceType: PricingType): PricingTypeDTO {
  switch (priceType) {
    case PricingType.Fixed:
      return PricingTypeDTO.Fixed;
  }
}

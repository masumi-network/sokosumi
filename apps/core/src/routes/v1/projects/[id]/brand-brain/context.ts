import { brandBrainSchema } from "@/schemas/brand-brain.schema";
import {
  parseBrandBrain,
  type StoredBrandBrain,
} from "@/services/brand-brain.service";

export function mapBrandBrainForApi(stored: StoredBrandBrain | null) {
  return brandBrainSchema.parse({
    brandBrain: parseBrandBrain(stored?.body),
    updatedAt: stored?.updatedAt ?? null,
    confirmedAt: stored?.confirmedAt ?? null,
    confirmedBy: stored?.confirmedBy ?? null,
  });
}

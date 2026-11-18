import { cmoCompetitorsSchema } from "@/schemas/cmo-competitors.schema";
import { getCmoCompetitors } from "@/services/cmo-competitors.service";
import type { CusoTarget } from "@/services/cmo-cuso.service";

import { rethrow } from "../../../helpers.js";

/** The Competitors tab of the Cuso a CMO call names, as the API returns it. */
export async function competitorsResponse(target: CusoTarget) {
  return cmoCompetitorsSchema.parse(
    await getCmoCompetitors(target).catch(rethrow),
  );
}

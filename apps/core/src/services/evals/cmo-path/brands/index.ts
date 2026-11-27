import type { CmoPathBrand } from "../types";
import { CRUMB_AND_KETTLE } from "./crumb-and-kettle";
import { TALLYFORM } from "./tallyform";

/**
 * The dev brands, all fictional. The held-out brands are written by someone
 * else and live outside this folder, so builders never read them.
 */
export const CMO_PATH_DEV_BRANDS: readonly CmoPathBrand[] = [
  TALLYFORM,
  CRUMB_AND_KETTLE,
];

import { formatDistance } from "date-fns";

export function getDateGroupKey(dateInput: Date | number): string | null {
  // TODO:
  // Add locale function
  // https://github.com/date-fns/date-fns/blob/dd66398305c2b015fba3c1b3d31ccff42ee8d4cf/src/locale/types.ts#L73
  return formatDistance(new Date(), new Date(dateInput));
}

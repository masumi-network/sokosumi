import { badRequest } from "@/helpers/error";

export function assertTaskLinkAllowed(
  fromTaskId: string,
  toTaskId: string,
): void {
  if (fromTaskId === toTaskId) {
    throw badRequest("A task cannot link to itself");
  }
}

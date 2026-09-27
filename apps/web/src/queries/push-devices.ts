import type { QueryClient } from "@tanstack/react-query";

export function getPushDevicesQueryKey(userId: string) {
  return ["push-devices", userId] as const;
}

/** Discard a read started before registration changed, then fetch the new list. */
export async function refreshPushDevices(
  queryClient: QueryClient,
  userId: string,
): Promise<void> {
  const queryKey = getPushDevicesQueryKey(userId);
  await queryClient.cancelQueries({ queryKey });
  await queryClient.invalidateQueries({ queryKey });
}

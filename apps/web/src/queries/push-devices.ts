import type { PushDevice } from "@sokosumi/core-client";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { readAblyPushDeviceId } from "@/lib/ably/release-push-device.client";
import { listPushDevices } from "@/lib/services/push-devices.service";

export interface PushDevicesData {
  devices: PushDevice[];
  currentDeviceId: string | null;
}

export function getPushDevicesQueryKey(userId: string | undefined) {
  return ["push-devices", userId] as const;
}

export function getPushDevicesQueryOptions(userId: string | undefined) {
  return queryOptions({
    queryKey: getPushDevicesQueryKey(userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<PushDevicesData> => {
      const before = userId ? readAblyPushDeviceId(userId) : null;
      const devices = await listPushDevices();
      const currentDeviceId =
        userId && before === readAblyPushDeviceId(userId) ? before : null;
      return {
        devices: devices.toSorted(
          (a, b) =>
            Number(b.id === currentDeviceId) - Number(a.id === currentDeviceId),
        ),
        currentDeviceId,
      };
    },
    retry: false,
  });
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

/** A successful registration supersedes the list's previous browser status. */
export async function clearPushDeviceSnapshot(
  queryClient: QueryClient,
  userId: string,
): Promise<void> {
  const queryKey = getPushDevicesQueryKey(userId);
  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData<PushDevicesData>(queryKey, (data) =>
    data ? { ...data, currentDeviceId: null } : data,
  );
}

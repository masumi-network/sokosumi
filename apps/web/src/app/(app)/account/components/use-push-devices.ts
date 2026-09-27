"use client";

import { useQuery } from "@tanstack/react-query";
import { readAblyPushDeviceId } from "@/lib/ably/release-push-device.client";
import { listPushDevices } from "@/lib/services/push-devices.service";
import { getPushDevicesQueryKey } from "@/queries/push-devices";

export function usePushDevices(userId: string, enabled = true) {
  return useQuery({
    queryKey: getPushDevicesQueryKey(userId),
    enabled,
    queryFn: async () => {
      const devices = await listPushDevices();
      const currentDeviceId = readAblyPushDeviceId(userId);
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

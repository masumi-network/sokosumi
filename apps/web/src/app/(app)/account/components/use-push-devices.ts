"use client";

import { useQuery } from "@tanstack/react-query";
import { readAblyPushDeviceId } from "@/lib/ably/release-push-device.client";
import { listPushDevices } from "@/lib/services/push-devices.service";
import { getPushDevicesQueryKey } from "@/queries/push-devices";

export function usePushDevices(userId: string, enabled = true) {
  return useQuery({
    queryKey: getPushDevicesQueryKey(userId),
    enabled,
    queryFn: async () => ({
      devices: await listPushDevices(),
      currentDeviceId: readAblyPushDeviceId(userId),
    }),
    retry: false,
  });
}

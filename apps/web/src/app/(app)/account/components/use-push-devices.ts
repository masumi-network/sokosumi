"use client";

import { useQuery } from "@tanstack/react-query";
import { readAblyPushDeviceId } from "@/lib/ably/release-push-device.client";
import { listPushDevices } from "@/lib/services/push-devices.service";

export function usePushDevices(userId: string) {
  return useQuery({
    queryKey: ["push-devices", userId],
    queryFn: async () => ({
      devices: await listPushDevices(),
      currentDeviceId: readAblyPushDeviceId(userId),
    }),
    retry: false,
  });
}

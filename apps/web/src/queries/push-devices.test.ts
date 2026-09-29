import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { getPushDevicesQueryKey, refreshPushDevices } from "./push-devices";

it("cancels a pre-registration read so its late empty result cannot replace the new device", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const key = getPushDevicesQueryKey("reader");
  let finishOld!: (devices: string[]) => void;
  const queryFn = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          finishOld = resolve;
        }),
    )
    .mockResolvedValue(["device"]);
  const observer = new QueryObserver(client, { queryKey: key, queryFn });
  const unsubscribe = observer.subscribe(() => {});
  await refreshPushDevices(client, "reader");
  expect(client.getQueryData(key)).toEqual(["device"]);
  finishOld([]);
  await Promise.resolve();
  expect(client.getQueryData(key)).toEqual(["device"]);
  unsubscribe();
  client.clear();
});

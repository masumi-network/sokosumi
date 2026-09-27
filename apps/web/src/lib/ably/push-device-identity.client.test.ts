import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasPushDeviceIdentity,
  rememberPushDeviceIdentity,
  reservePushDeviceIdentity,
} from "./push-device-identity.client";

const MARKER_KEY = "sokosumi.push.identifiedDevice";

describe("push device identity marker", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reserves space without treating the old registration as migrated", () => {
    reservePushDeviceIdentity("reader", "legacy");
    const reserved = localStorage.getItem(MARKER_KEY);
    expect(hasPushDeviceIdentity("reader", "legacy")).toBe(false);
    rememberPushDeviceIdentity("reader", {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      clientId: "reader:tab",
    });
    expect((localStorage.getItem(MARKER_KEY) ?? "").length).toBeLessThan(
      (reserved ?? "").length,
    );
    expect(hasPushDeviceIdentity("reader", "01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(
      true,
    );
  });

  it("keeps an existing completed marker when reserving for the same device", () => {
    rememberPushDeviceIdentity("reader", {
      id: "device",
      clientId: "reader:tab",
    });
    reservePushDeviceIdentity("reader", "device");
    expect(hasPushDeviceIdentity("reader", "device")).toBe(true);
  });

  it("requires the same reader and device ID", () => {
    rememberPushDeviceIdentity("reader", {
      id: "device",
      clientId: "reader:tab",
    });
    expect(hasPushDeviceIdentity("reader", "device")).toBe(true);
    expect(hasPushDeviceIdentity("other", "device")).toBe(false);
    expect(hasPushDeviceIdentity("reader", "new-device")).toBe(false);
    expect(hasPushDeviceIdentity("reader", null)).toBe(false);
  });

  it.each(["invalid", "null", "{}", JSON.stringify({ userId: "reader" })])(
    "rejects malformed markers: %s",
    (value) => {
      localStorage.setItem(MARKER_KEY, value);
      expect(hasPushDeviceIdentity("reader", "device")).toBe(false);
    },
  );

  it.each([undefined, "reader-2:tab", "reader"])(
    "does not mark an unbound or foreign identity: %s",
    (clientId) => {
      expect(() =>
        rememberPushDeviceIdentity("reader", { id: "device", clientId }),
      ).toThrow("Push device identity does not match the current reader");
      expect(hasPushDeviceIdentity("reader", "device")).toBe(false);
    },
  );

  it("does not claim migration when storage refuses the write", () => {
    vi.mocked(localStorage.setItem).mockImplementation(() => {
      throw new Error("Storage blocked");
    });
    expect(() =>
      rememberPushDeviceIdentity("reader", {
        id: "device",
        clientId: "reader:tab",
      }),
    ).toThrow("Storage blocked");
    expect(hasPushDeviceIdentity("reader", "device")).toBe(false);
  });

  it("treats blocked reads as an unconfirmed migration", () => {
    vi.mocked(localStorage.getItem).mockImplementation(() => {
      throw new Error("Storage blocked");
    });
    expect(hasPushDeviceIdentity("reader", "device")).toBe(false);
  });
});

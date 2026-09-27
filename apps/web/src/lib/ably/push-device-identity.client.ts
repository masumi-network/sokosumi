"use client";

const PUSH_DEVICE_IDENTITY_KEY = "sokosumi.push.identifiedDevice";
// Ably creates device IDs with ulid() in LocalDevice.resetId().
const ABLY_DEVICE_ID_LENGTH = 26;

/** Only registrations created with an explicit SDK clientId have this marker. */
export function hasPushDeviceIdentity(
  userId: string,
  deviceId: string | null,
): boolean {
  if (!deviceId) return false;
  try {
    const marker: unknown = JSON.parse(
      localStorage.getItem(PUSH_DEVICE_IDENTITY_KEY) ?? "null",
    );
    return (
      typeof marker === "object" &&
      marker !== null &&
      !("pending" in marker) &&
      "userId" in marker &&
      marker.userId === userId &&
      "deviceId" in marker &&
      marker.deviceId === deviceId
    );
  } catch {
    return false;
  }
}

/** Reserve the final marker's space before changing a working registration. */
export function reservePushDeviceIdentity(
  userId: string,
  deviceId: string,
): void {
  if (hasPushDeviceIdentity(userId, deviceId)) return;
  localStorage.setItem(
    PUSH_DEVICE_IDENTITY_KEY,
    JSON.stringify({
      userId,
      deviceId: deviceId.padEnd(ABLY_DEVICE_ID_LENGTH, " "),
      pending: true,
    }),
  );
}

export function rememberPushDeviceIdentity(
  userId: string,
  device: { id: string; clientId?: string },
): void {
  if (
    !device.id ||
    !("clientId" in device) ||
    typeof device.clientId !== "string" ||
    !device.clientId.startsWith(`${userId}:`)
  ) {
    throw new Error("Push device identity does not match the current reader");
  }
  // A failed write must leave this registration eligible for migration.
  localStorage.setItem(
    PUSH_DEVICE_IDENTITY_KEY,
    JSON.stringify({ userId, deviceId: device.id }),
  );
}

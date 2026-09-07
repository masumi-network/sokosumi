import { execFileSync as defaultExecFileSync } from "node:child_process";

const KEYCHAIN_COMMAND = "/usr/bin/security";
const KEYCHAIN_SERVICE = "sokosumi-cli";
const KEYCHAIN_ACCOUNT = "oauth";

function keychainError(action) {
  return new Error(
    `OS keychain is required to ${action} interactive Sokosumi credentials`,
  );
}

function isMissingItem(error) {
  const details = [error?.stderr, error?.message].filter(Boolean).join(" ");
  return (
    error?.status === 44 ||
    /could not be found|errSecItemNotFound|-25300/i.test(details)
  );
}

function assertCredentials(credentials) {
  if (
    !credentials ||
    typeof credentials !== "object" ||
    Array.isArray(credentials)
  ) {
    throw new TypeError("credentials must be an object");
  }
  if (
    typeof credentials.authToken !== "string" ||
    credentials.authToken.trim().length === 0
  ) {
    throw new TypeError("credentials.authToken is required");
  }
}

export function createKeychainCredentialStore({
  platform = process.platform,
  execFileSync = defaultExecFileSync,
  serviceName = KEYCHAIN_SERVICE,
  accountName = KEYCHAIN_ACCOUNT,
} = {}) {
  const supported = platform === "darwin";
  const commonArgs = ["-a", accountName, "-s", serviceName];

  return {
    read() {
      if (!supported) return null;

      try {
        const output = execFileSync(
          KEYCHAIN_COMMAND,
          ["find-generic-password", ...commonArgs, "-w"],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
        const value = String(output || "").trim();
        if (!value) return null;
        const credentials = JSON.parse(value);
        return credentials &&
          typeof credentials === "object" &&
          !Array.isArray(credentials)
          ? credentials
          : null;
      } catch (error) {
        if (isMissingItem(error)) return null;
        throw keychainError("read");
      }
    },

    write(credentials) {
      if (!supported) throw keychainError("store");
      assertCredentials(credentials);

      execFileSync(
        KEYCHAIN_COMMAND,
        [
          "add-generic-password",
          ...commonArgs,
          "-w",
          JSON.stringify(credentials),
          "-U",
        ],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
    },

    clear() {
      if (!supported) return;

      try {
        execFileSync(
          KEYCHAIN_COMMAND,
          ["delete-generic-password", ...commonArgs],
          { stdio: ["ignore", "ignore", "pipe"] },
        );
      } catch (error) {
        if (!isMissingItem(error)) throw keychainError("clear");
      }
    },

    isSupported: supported,
  };
}

export const keychainCredentialStore = createKeychainCredentialStore();

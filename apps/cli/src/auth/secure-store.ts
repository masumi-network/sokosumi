import type { ExecFileSyncOptions } from "node:child_process";
import { execFileSync as defaultExecFileSync } from "node:child_process";
import { createRequire } from "node:module";

export interface CredentialStore<T extends object = Record<string, unknown>> {
  readonly isSupported?: boolean;
  read(): T | null;
  write(value: T): void;
  clear(): void;
}

interface EntryLike {
  getPassword(): string | null;
  setPassword(value: string): void;
  deletePassword(): boolean;
}

type ExecFileSyncLike = (
  command: string,
  args: readonly string[],
  options: ExecFileSyncOptions,
) => string | Buffer;
interface ExecFileSyncError {
  code?: string;
  status?: number;
  stderr?: string | Buffer;
}

type CredentialStoreOptions = {
  platform?: NodeJS.Platform;
  execFileSync?: ExecFileSyncLike;
  entryFactory?: (serviceName: string, accountName: string) => EntryLike;
  serviceName?: string;
  accountName?: string;
};

const SECRET_TOOL_COMMAND = "secret-tool";
const DEFAULT_SERVICE_NAME = "sokosumi-cli";
const DEFAULT_ACCOUNT_NAME = "oauth";

const require = createRequire(import.meta.url);

function createNativeEntry(
  serviceName: string,
  accountName: string,
): EntryLike {
  const keyring = require("@napi-rs/keyring") as {
    Entry: new (serviceName: string, accountName: string) => EntryLike;
  };
  return new keyring.Entry(serviceName, accountName);
}

function vaultError(action: string): Error {
  return new Error(
    `OS credential vault is required to ${action} interactive Sokosumi credentials`,
  );
}

function parseStoredValue<T extends object>(value: string | null): T | null {
  if (!value?.trim()) return null;
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return parsed as T;
}
function isMissingSecretItem(error: unknown): boolean {
  const candidate = error as ExecFileSyncError;
  if (candidate.status !== 1) return false;
  const stderr = String(candidate.stderr || "");
  return /no (?:such )?secret(?: item)?(?: found)?/iu.test(stderr);
}

function ensureSecretService(
  execFileSync: ExecFileSyncLike,
  serviceName: string,
  accountName: string,
): boolean {
  try {
    execFileSync(
      SECRET_TOOL_COMMAND,
      ["lookup", "service", serviceName, "account", accountName],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return true;
  } catch (error) {
    const candidate = error as ExecFileSyncError;
    return candidate.code !== "ENOENT" && isMissingSecretItem(error);
  }
}

function createUnsupportedStore<T extends object>(): CredentialStore<T> {
  return {
    isSupported: false,
    read: () => null,
    write: () => {
      throw vaultError("store");
    },
    clear: () => {},
  };
}

function createNativeCredentialStore<T extends object>({
  entryFactory,
  serviceName,
  accountName,
}: Required<
  Pick<CredentialStoreOptions, "entryFactory" | "serviceName" | "accountName">
>): CredentialStore<T> {
  const entry = entryFactory(serviceName, accountName);
  return {
    isSupported: true,
    read() {
      try {
        return parseStoredValue<T>(entry.getPassword());
      } catch {
        throw vaultError("read");
      }
    },
    write(value) {
      try {
        entry.setPassword(JSON.stringify(value));
      } catch {
        throw vaultError("store");
      }
    },
    clear() {
      try {
        entry.deletePassword();
      } catch {
        throw vaultError("clear");
      }
    },
  };
}

function createLinuxCredentialStore<T extends object>({
  execFileSync,
  serviceName,
  accountName,
}: Required<
  Pick<CredentialStoreOptions, "execFileSync" | "serviceName" | "accountName">
>): CredentialStore<T> {
  const supported = ensureSecretService(execFileSync, serviceName, accountName);
  if (!supported) return createUnsupportedStore<T>();

  const attributes = ["service", serviceName, "account", accountName];
  return {
    isSupported: true,
    read() {
      try {
        const output = execFileSync(
          SECRET_TOOL_COMMAND,
          ["lookup", ...attributes],
          {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        return parseStoredValue<T>(String(output || "").trim());
      } catch (error) {
        if (isMissingSecretItem(error)) return null;
        throw vaultError("read");
      }
    },
    write(value) {
      try {
        execFileSync(
          SECRET_TOOL_COMMAND,
          ["store", "--label", "Sokosumi CLI", ...attributes],
          {
            input: JSON.stringify(value),
            stdio: ["pipe", "ignore", "pipe"],
          },
        );
      } catch {
        throw vaultError("store");
      }
    },
    clear() {
      try {
        execFileSync(SECRET_TOOL_COMMAND, ["clear", ...attributes], {
          stdio: ["ignore", "ignore", "pipe"],
        });
      } catch (error) {
        if (!isMissingSecretItem(error)) throw vaultError("clear");
      }
    },
  };
}

export function createCredentialStore<
  T extends object = Record<string, unknown>,
>({
  platform = process.platform,
  execFileSync = defaultExecFileSync as ExecFileSyncLike,
  entryFactory = createNativeEntry,
  serviceName = DEFAULT_SERVICE_NAME,
  accountName = DEFAULT_ACCOUNT_NAME,
}: CredentialStoreOptions = {}): CredentialStore<T> {
  if (platform === "darwin" || platform === "win32") {
    return createNativeCredentialStore({
      entryFactory,
      serviceName,
      accountName,
    });
  }
  if (platform === "linux") {
    return createLinuxCredentialStore({
      execFileSync,
      serviceName,
      accountName,
    });
  }
  return createUnsupportedStore<T>();
}

export function createAuthCredentialStores<
  TOAuth extends object = Record<string, unknown>,
  TApiKey extends object = Record<string, unknown>,
>({
  targetScope,
  clientId,
  ...options
}: CredentialStoreOptions & {
  targetScope: string;
  clientId: string;
}): {
  oauth: CredentialStore<TOAuth>;
  apiKey: CredentialStore<TApiKey>;
} {
  const safeClientId = clientId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return {
    oauth: createCredentialStore({
      ...options,
      serviceName: DEFAULT_SERVICE_NAME,
      accountName: `${targetScope}:oauth:${safeClientId}`,
    }),
    apiKey: createCredentialStore({
      ...options,
      serviceName: DEFAULT_SERVICE_NAME,
      accountName: `${targetScope}:user-api-key`,
    }),
  };
}

import { beforeEach, describe, expect, it, vi } from "vitest";

const setPasswordViaCoreMock = vi.fn();
const handleUTMConversionMock = vi.fn();

vi.mock("@/lib/auth/core-auth-http.server", () => ({
  setPasswordViaCore: (...args: unknown[]) => setPasswordViaCoreMock(...args),
}));

vi.mock("@/lib/services/utm.service", () => ({
  utmService: {
    handleUTMConversion: (...args: unknown[]) =>
      handleUTMConversionMock(...args),
  },
}));

describe("createCredentialAccount", () => {
  beforeEach(() => {
    setPasswordViaCoreMock.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("sets the password through Core auth", async () => {
    setPasswordViaCoreMock.mockResolvedValue(undefined);

    const { createCredentialAccount } = await import("../action");

    const result = await createCredentialAccount({
      newPassword: "Password-123456",
      confirmNewPassword: "Password-123456",
    });

    expect(result.ok).toBe(true);
    expect(setPasswordViaCoreMock).toHaveBeenCalledWith("Password-123456");
  });

  it("returns BAD_INPUT for invalid form data", async () => {
    const { createCredentialAccount } = await import("../action");

    const result = await createCredentialAccount({
      newPassword: "short",
      confirmNewPassword: "short",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("BAD_INPUT");
    }
    expect(setPasswordViaCoreMock).not.toHaveBeenCalled();
  });

  it("maps Core auth errors to action errors", async () => {
    const error = new Error("password already set") as Error & {
      code: string;
    };
    error.code = "PASSWORD_ALREADY_SET";
    setPasswordViaCoreMock.mockRejectedValue(error);

    const { createCredentialAccount } = await import("../action");

    const result = await createCredentialAccount({
      newPassword: "Password-123456",
      confirmNewPassword: "Password-123456",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        code: "PASSWORD_ALREADY_SET",
        message: "password already set",
      });
    }
  });
});

describe("handleUtmConversion", () => {
  beforeEach(() => {
    handleUTMConversionMock.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("records UTM attribution via utmService", async () => {
    handleUTMConversionMock.mockResolvedValue(undefined);

    const { handleUtmConversion } = await import("../action");

    await handleUtmConversion();

    expect(handleUTMConversionMock).toHaveBeenCalledTimes(1);
  });

  it("swallows utmService failures without throwing", async () => {
    handleUTMConversionMock.mockRejectedValue(new Error("utm failed"));

    const { handleUtmConversion } = await import("../action");

    await expect(handleUtmConversion()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      "Failed to create utm attribution",
      expect.any(Error),
    );
  });
});

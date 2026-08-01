import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUserByIdMock, resolveDatabaseHookUserIdMock } = vi.hoisted(() => ({
  getUserByIdMock: vi.fn(),
  resolveDatabaseHookUserIdMock: vi.fn(),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  userRepository: {
    getUserById: (...args: unknown[]) => getUserByIdMock(...args),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {},
}));

vi.mock("@/services/stripe-user-email.service", () => ({
  resolveDatabaseHookUserId: (...args: unknown[]) =>
    resolveDatabaseHookUserIdMock(...args),
}));

import { applyCustomAvatarImageGuardToUserUpdate } from "./custom-avatar-image-auth";

const USER_ID = "user_123";
const CUSTOM_AVATAR = "https://blob.example/users/user_123/avatar.png";
const OTHER_CUSTOM_AVATAR = "https://blob.example/users/user_123/avatar-v2.png";
const OAUTH_AVATAR = "https://lh3.googleusercontent.com/a/oauth-photo";

describe("applyCustomAvatarImageGuardToUserUpdate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveDatabaseHookUserIdMock.mockReturnValue(USER_ID);
  });

  it("returns unchanged when image is not in the update", async () => {
    const updateData = { name: "Ada" };
    await expect(
      applyCustomAvatarImageGuardToUserUpdate(updateData, {}),
    ).resolves.toEqual(updateData);
    expect(getUserByIdMock).not.toHaveBeenCalled();
  });

  it("allows clearing a custom avatar with null", async () => {
    getUserByIdMock.mockResolvedValue({ image: CUSTOM_AVATAR });

    await expect(
      applyCustomAvatarImageGuardToUserUpdate({ image: null }, {}),
    ).resolves.toEqual({ image: null });
    expect(getUserByIdMock).not.toHaveBeenCalled();
  });

  it("blocks OAuth wipe of an existing custom avatar", async () => {
    getUserByIdMock.mockResolvedValue({ image: CUSTOM_AVATAR });

    await expect(
      applyCustomAvatarImageGuardToUserUpdate({ image: OAUTH_AVATAR }, {}),
    ).resolves.toEqual({});
    expect(getUserByIdMock).toHaveBeenCalledWith(USER_ID, expect.anything());
  });

  it("allows replacing a custom avatar with another owned upload", async () => {
    getUserByIdMock.mockResolvedValue({ image: CUSTOM_AVATAR });

    await expect(
      applyCustomAvatarImageGuardToUserUpdate(
        { image: OTHER_CUSTOM_AVATAR },
        {},
      ),
    ).resolves.toEqual({ image: OTHER_CUSTOM_AVATAR });
  });

  it("allows OAuth image when the user has no custom avatar", async () => {
    getUserByIdMock.mockResolvedValue({ image: OAUTH_AVATAR });

    await expect(
      applyCustomAvatarImageGuardToUserUpdate(
        { image: "https://lh3.googleusercontent.com/a/new" },
        {},
      ),
    ).resolves.toEqual({
      image: "https://lh3.googleusercontent.com/a/new",
    });
  });

  it("allows first custom upload when existing image is null", async () => {
    getUserByIdMock.mockResolvedValue({ image: null });

    await expect(
      applyCustomAvatarImageGuardToUserUpdate({ image: CUSTOM_AVATAR }, {}),
    ).resolves.toEqual({ image: CUSTOM_AVATAR });
  });
});

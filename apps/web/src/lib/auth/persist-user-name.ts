import { authClient } from "@/lib/auth/auth.client";

export function userHasName(name: string | null | undefined): boolean {
  return Boolean(name?.trim());
}

export async function persistUserName(
  name: string,
): Promise<{ ok: true } | { ok: false; message?: string }> {
  try {
    const result = await authClient.updateUser({ name });
    if (result.error) {
      return { ok: false, message: result.error.message };
    }
    return { ok: true };
  } catch (error) {
    console.error("Persist user name failed", error);
    return { ok: false };
  }
}

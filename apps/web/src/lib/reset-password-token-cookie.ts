import { cookies } from "next/headers";

import {
  RESET_PASSWORD_PATH,
  RESET_PASSWORD_TOKEN_COOKIE_NAME,
  RESET_PASSWORD_TOKEN_MAX_AGE_SECONDS,
} from "@/lib/reset-password-token";

const RESET_PASSWORD_TOKEN_MAX_LENGTH = 256;

function isUsableResetPasswordToken(token: string): boolean {
  return (
    token.length > 0 &&
    token.length <= RESET_PASSWORD_TOKEN_MAX_LENGTH &&
    !/\s/.test(token)
  );
}

interface MutableCookieStore {
  set: (options: {
    name: string;
    value: string;
    httpOnly: boolean;
    sameSite: "lax";
    path: string;
    secure: boolean;
    maxAge: number;
  }) => void;
}

export function applyResetPasswordTokenCookie(
  store: MutableCookieStore,
  token: string,
  secure: boolean,
): void {
  if (!isUsableResetPasswordToken(token)) {
    return;
  }

  store.set({
    name: RESET_PASSWORD_TOKEN_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    path: RESET_PASSWORD_PATH,
    secure,
    maxAge: RESET_PASSWORD_TOKEN_MAX_AGE_SECONDS,
  });
}

export async function getResetPasswordToken(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(RESET_PASSWORD_TOKEN_COOKIE_NAME)?.value;
  return token && isUsableResetPasswordToken(token) ? token : null;
}

export async function clearResetPasswordToken(): Promise<void> {
  const store = await cookies();
  store.set({
    name: RESET_PASSWORD_TOKEN_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: RESET_PASSWORD_PATH,
    secure: false,
    maxAge: 0,
  });
}

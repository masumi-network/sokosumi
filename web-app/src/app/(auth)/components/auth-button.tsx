"use client";

import { usePathname } from "next/navigation";

import { SignInButton, SignUpButton } from "../buttons";

export default function AuthButton() {
  const pathname = usePathname();

  if (pathname.startsWith("/signin")) return <SignUpButton />;

  return <SignInButton />;
}

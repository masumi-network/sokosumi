"use client";

import { usePathname } from "next/navigation";

import { SignInButton, SignUpButton } from "@/app/(landing)/(auth)/buttons";

export default function AuthButton() {
  const pathname = usePathname();

  if (pathname.startsWith("/signin")) return <SignUpButton />;

  if (pathname.startsWith("/signup")) return <SignInButton />;

  return (
    <div className="flex gap-4">
      <SignInButton variant="outline" />
      <SignUpButton />
    </div>
  );
}

"use client";

import { usePathname } from "next/navigation";

import { SignInButton, SignUpButton } from "@/app/(landing)/(auth)/buttons";

interface AuthButtonsProps {
  containerClassName?: string;
}

export default function AuthButtons({
  containerClassName = "flex items-center gap-4",
}: AuthButtonsProps) {
  const pathname = usePathname();

  if (pathname.startsWith("/signin")) return <SignUpButton />;

  if (pathname.startsWith("/signup")) return <SignInButton />;

  return (
    <div className={containerClassName}>
      <SignInButton variant="outline" />
      <SignUpButton />
    </div>
  );
}

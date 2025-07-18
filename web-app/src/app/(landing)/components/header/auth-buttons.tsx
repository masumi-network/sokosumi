"use client";

import { usePathname } from "next/navigation";

import { SignInButton, SignUpButton } from "@/auth/components/buttons";

interface AuthButtonsProps {
  className?: string | undefined;
}

export default function AuthButtons({ className }: AuthButtonsProps) {
  const pathname = usePathname();

  if (pathname.startsWith("/login"))
    return <SignUpButton className={className} />;

  if (pathname.startsWith("/register"))
    return <SignInButton className={className} />;

  return <SignUpButton className={className} />;
}

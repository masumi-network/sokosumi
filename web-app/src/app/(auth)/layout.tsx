import { X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Sokosumi - Sign In / Sign Up",
  description: "Sokosumi - Sign In / Sign Up",
};

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center">
      <div className="flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
        <div className="flex items-center justify-start">
          <Link href="/">
            <Button className="h-10 w-10 rounded-md bg-black">
              <X className="text-md text-white" />
            </Button>
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center rounded-lg border border-gray-200 p-3">
          <div className="flex w-full flex-col">{children}</div>
        </div>
      </div>
    </div>
  );
}

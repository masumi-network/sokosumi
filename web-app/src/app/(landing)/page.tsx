import Link from "next/link";

import { MainNav } from "@/app/(landing)/components/main-nav";
import SokosumiLogo from "@/app/components/sokosumi-logo";

export default function Home() {
  return (
    <nav className="bg-landing w-full px-8 py-4 border-b">
      <div className="container mx-auto flex items-center justify-between">
        {/* Left - Logo */}
        <div className="flex items-center">
          <SokosumiLogo />
        </div>

        {/* Middle - Navigation Links */}
        <div className="flex items-center gap-8">
          <MainNav />
        </div>

        {/* Right - Auth Buttons */}
        <div className="flex items-center gap-4">
          <Link 
            href="/signin"
            className="px-4 py-2 text-sm hover:text-gray-600 transition-colors"
          >
            Sign In
          </Link>
          <Link 
            href="/signup"
            className="px-4 py-2 text-sm bg-black text-white rounded-md hover:bg-gray-800 transition-colors"
          >
            Sign Up
          </Link>
        </div>
      </div>
    </nav>
  );
}

import Link from "next/link";

export function AuthButtons() {
  return (
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
  );
} 
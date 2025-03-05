import Link from "next/link";

export function AuthButtons() {
  return (
    <div className="flex items-center gap-4">
      <Link
        href="/signin"
        className="px-4 py-2 text-sm transition-colors hover:text-gray-600"
      >
        Sign In
      </Link>
      <Link
        href="/signup"
        className="rounded-md bg-black px-4 py-2 text-sm text-white transition-colors hover:bg-gray-800"
      >
        Sign Up
      </Link>
    </div>
  );
}

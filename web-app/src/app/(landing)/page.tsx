import Link from "next/link";

export default function Home() {
  return (
    <div className="flex items-center justify-center gap-16 p-8 sm:p-20">
      <Link href="/">Sokosumi</Link>
      <Link href="/signin">Sign In</Link>
      <Link href="/signup">Sign Up</Link>
    </div>
  );
}

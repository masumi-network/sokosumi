import Link from "next/link";

export default function SokosumiLogo() {
  return (
    <div className="flex items-center">
      <Link href="/" className="text-xl font-bold">
        Sokosumi
      </Link>
    </div>
  );
}
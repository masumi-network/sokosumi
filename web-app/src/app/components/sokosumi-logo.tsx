import Image from "next/image";
import Link from "next/link";

export default function SokosumiLogo() {
  return (
    <div className="flex items-center">
      <Link href="/" className="text-xl font-bold">
        <Image 
          src="/sokosumi-logo.svg" 
          alt="Sokosumi Logo" 
          width={200} 
          height={26}
          priority={false}
        />
      </Link>
    </div>
  );
}


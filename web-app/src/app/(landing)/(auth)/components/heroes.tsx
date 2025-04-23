import Image from "next/image";

export default function Heroes() {
  return (
    <div className="p-4">
      <div className="relative h-96 w-full">
        <Image
          src="/placeholder.svg"
          alt="Hero"
          fill
          // sizes="100vw"
          className="rounded-lg object-cover"
        />
      </div>
    </div>
  );
}

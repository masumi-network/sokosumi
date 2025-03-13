import Image from "next/image";

export default function Heroes() {
  return (
    <div className="grid grid-cols-2 grid-rows-2 gap-8">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="relative h-56 w-56">
          <Image
            src="/placeholder.svg"
            alt="Hero"
            fill
            className="object-cover"
          />
        </div>
      ))}
    </div>
  );
}

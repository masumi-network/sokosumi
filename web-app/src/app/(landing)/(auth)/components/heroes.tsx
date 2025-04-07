import Image from "next/image";

export default function Heroes() {
  return (
    <div className="grid grid-cols-2 grid-rows-2 gap-8">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="relative h-48 w-48 xl:h-56 xl:w-56">
          <Image
            src="/placeholder.svg"
            alt="Hero"
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            className="object-cover"
          />
        </div>
      ))}
    </div>
  );
}

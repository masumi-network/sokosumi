import { SokosumiLoader } from "@/components/ui/sokosumi-loader";

export default function SokoBotLoading() {
  return (
    <div className="flex min-h-[60dvh] w-full items-center justify-center">
      <SokosumiLoader size={40} />
    </div>
  );
}

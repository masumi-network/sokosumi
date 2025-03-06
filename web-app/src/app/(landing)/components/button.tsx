import { Button } from "@/components/ui/button";

export function WhiteButton({ title }: { title: string }) {
  return (
    <Button
      size="lg"
      className="border-black bg-white text-black hover:bg-gray-100"
    >
      {title}
    </Button>
  );
}

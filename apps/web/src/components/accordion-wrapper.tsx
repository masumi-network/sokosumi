import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface AccordionItemWrapperProps {
  value: string;
  title: string;
  disabled?: boolean | undefined;
  children: React.ReactNode;
  verificationBadge?: React.ReactNode;
}

export default function AccordionItemWrapper({
  value,
  title,
  disabled = false,
  children,
  verificationBadge,
}: AccordionItemWrapperProps) {
  return (
    <AccordionItem value={value} className="bg-muted/50 rounded-xl border-none">
      <AccordionTrigger className="p-4" disabled={disabled}>
        <p className="inline-flex text-base">
          {title}
          {verificationBadge}
        </p>
      </AccordionTrigger>
      <AccordionContent className="p-4">{children}</AccordionContent>
    </AccordionItem>
  );
}

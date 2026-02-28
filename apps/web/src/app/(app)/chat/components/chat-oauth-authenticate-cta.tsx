import { Button } from "@/components/ui/button";

interface ChatOAuthAuthenticateCtaProps {
  href: string;
  label: string;
}

export function ChatOAuthAuthenticateCta({
  href,
  label,
}: ChatOAuthAuthenticateCtaProps) {
  return (
    <div className="mt-3 flex justify-end">
      <Button asChild size="sm" variant="default">
        <a href={href} target="_blank" rel="noopener noreferrer">
          {label}
        </a>
      </Button>
    </div>
  );
}

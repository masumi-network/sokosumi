import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

interface AgentModalProps {
  children: React.ReactNode;
  open?: boolean | undefined;
}

export function AgentModal({ children, open }: AgentModalProps) {
  return (
    <Dialog open={open ?? true}>
      <DialogPortal>
        <DialogOverlay className="backdrop-blur-lg" />
        <DialogContent className="w-[80vw] max-w-3xl! border-none bg-transparent p-0 focus:ring-0 focus:outline-none [&>button]:hidden">
          <DialogTitle className="hidden" />
          <DialogDescription className="hidden" />
          <ScrollArea className="max-h-[90svh]">{children}</ScrollArea>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

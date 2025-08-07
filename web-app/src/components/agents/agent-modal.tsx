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
        <DialogContent className="w-svw max-w-3xl! border-none bg-transparent p-0 focus:ring-0 focus:outline-none md:w-[80vw] [&>button]:hidden">
          <DialogTitle className="hidden" />
          <DialogDescription className="hidden" />
          <ScrollArea className="max-h-svh pt-12 pr-4 pl-4 md:max-h-[90svh] md:p-0">
            {children}
          </ScrollArea>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

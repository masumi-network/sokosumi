import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AgentListWithAgent, AgentWithRelations, CreditsPrice } from "@/lib/db";

import {
  CardSection1,
  CardSection2,
  CardSection3,
  CardSection4,
  CardSection5,
  CardSection6,
} from "./card-sections";

interface AgentModalProps {
  agent: AgentWithRelations | undefined;
  agentList?: AgentListWithAgent | undefined;
  agentCreditsPrice: CreditsPrice | undefined;
  onCloseModal: () => void;
}

function AgentModal({
  agent,
  agentList,
  agentCreditsPrice,
  onCloseModal,
}: AgentModalProps) {
  const handleOnOpenChange = (open: boolean) => {
    if (!open) {
      onCloseModal();
    }
  };

  if (!agent || !agentCreditsPrice) {
    return null;
  }

  return (
    <Dialog defaultOpen={true} onOpenChange={handleOnOpenChange}>
      <DialogPortal>
        <DialogOverlay className="backdrop-blur-lg" />
        <DialogContent className="w-[80vw] max-w-3xl! border-none bg-transparent p-0 [&>button]:hidden">
          <DialogTitle className="hidden" />
          <DialogDescription className="hidden" />
          <ScrollArea className="max-h-[90svh]">
            <div className="flex w-[80vw] max-w-3xl! flex-col gap-1.5">
              <CardSection1
                agent={agent}
                agentList={agentList}
                agentCreditsPrice={agentCreditsPrice}
                onCloseModal={onCloseModal}
              />
              <CardSection2 agent={agent} />
              <CardSection3 agent={agent} />
              <CardSection4 agent={agent} />
              <CardSection5 agent={agent} />
              <CardSection6 agent={agent} />
            </div>
          </ScrollArea>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

export { AgentModal };

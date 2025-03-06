import AgentAddButton from "./components/agent-add-button";
import AgentsList from "./components/agents-list";

export default function MainLeftPanel() {
  return (
    <div className="hidden h-full w-64 flex-col md:flex">
      <AgentsList className="flex-1" />
      <AgentAddButton />
    </div>
  );
}

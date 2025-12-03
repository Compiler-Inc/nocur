import { ProjectPane } from "@/components/panes/ProjectPane";
import { SimulatorPane } from "@/components/panes/SimulatorPane";
import { AgentPane } from "@/components/panes/AgentPane";

const App = () => {
  return (
    <div className="flex h-screen w-screen bg-background text-foreground">
      {/* Left Pane: Project */}
      <div className="w-64 min-w-48 border-r border-border flex flex-col">
        <ProjectPane />
      </div>

      {/* Center Pane: Simulator */}
      <div className="flex-1 min-w-96 border-r border-border flex flex-col">
        <SimulatorPane />
      </div>

      {/* Right Pane: Agent */}
      <div className="w-96 min-w-72 flex flex-col">
        <AgentPane />
      </div>
    </div>
  );
};

export default App;

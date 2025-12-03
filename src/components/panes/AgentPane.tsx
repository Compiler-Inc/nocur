export const AgentPane = () => {
  return (
    <>
      {/* Header */}
      <div className="h-12 px-4 flex items-center justify-between border-b border-border">
        <h2 className="text-sm font-medium text-muted-foreground">Agent</h2>
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-zinc-500" />
          <span className="text-xs text-muted-foreground">Idle</span>
        </div>
      </div>

      {/* Agent Terminal */}
      <div className="flex-1 overflow-auto">
        {/* What Agent Sees section */}
        <div className="border-b border-border">
          <div className="px-4 py-2 bg-muted/30">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Agent Vision
            </p>
          </div>
          <div className="p-4">
            <div className="rounded-md border border-dashed border-border p-4 text-center">
              <p className="text-xs text-muted-foreground">
                Screenshots and hierarchy data
                <br />
                the agent receives will appear here
              </p>
            </div>
          </div>
        </div>

        {/* Terminal output section */}
        <div>
          <div className="px-4 py-2 bg-muted/30">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Terminal
            </p>
          </div>
          <div className="p-4 font-mono text-xs">
            <div className="rounded-md bg-zinc-950 p-4 min-h-48">
              <p className="text-zinc-500">$ claude</p>
              <p className="text-zinc-400 mt-2">
                Claude Code agent not started.
              </p>
              <p className="text-zinc-500 mt-4">
                <span className="text-green-500">▶</span> Start agent to begin...
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Input area */}
      <div className="border-t border-border p-4">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Send a message to the agent..."
            className="flex-1 px-3 py-2 text-sm rounded-md bg-muted border border-border focus:outline-none focus:ring-1 focus:ring-ring"
            disabled
          />
          <button
            className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            disabled
          >
            Send
          </button>
        </div>
      </div>
    </>
  );
};

export const SimulatorPane = () => {
  return (
    <>
      {/* Header */}
      <div className="h-12 px-4 flex items-center justify-between border-b border-border">
        <h2 className="text-sm font-medium text-muted-foreground">Simulator</h2>
        <div className="flex items-center gap-2">
          <button className="px-2 py-1 text-xs rounded bg-muted hover:bg-muted/80 text-muted-foreground">
            Screenshot
          </button>
          <button className="px-2 py-1 text-xs rounded bg-muted hover:bg-muted/80 text-muted-foreground">
            Hierarchy
          </button>
        </div>
      </div>

      {/* Simulator View */}
      <div className="flex-1 flex items-center justify-center p-4 bg-black/20">
        <div className="relative">
          {/* Device frame placeholder */}
          <div className="w-72 h-[580px] rounded-3xl border-4 border-zinc-700 bg-zinc-900 flex items-center justify-center">
            <div className="text-center space-y-2">
              <div className="text-4xl text-zinc-600">📱</div>
              <p className="text-xs text-zinc-500">No simulator running</p>
              <button className="mt-2 px-3 py-1 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90">
                Boot Simulator
              </button>
            </div>
          </div>

          {/* Notch */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-24 h-6 bg-zinc-800 rounded-full" />
        </div>
      </div>

      {/* Bottom toolbar */}
      <div className="h-10 px-4 flex items-center justify-between border-t border-border bg-muted/30">
        <span className="text-xs text-muted-foreground">iPhone 15 Pro</span>
        <div className="flex items-center gap-3">
          <button className="text-xs text-muted-foreground hover:text-foreground">
            Tap
          </button>
          <button className="text-xs text-muted-foreground hover:text-foreground">
            Scroll
          </button>
          <button className="text-xs text-muted-foreground hover:text-foreground">
            Type
          </button>
        </div>
      </div>
    </>
  );
};

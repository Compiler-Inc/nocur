export const ProjectPane = () => {
  return (
    <>
      {/* Header */}
      <div className="h-12 px-4 flex items-center border-b border-border">
        <h2 className="text-sm font-medium text-muted-foreground">Project</h2>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-4">
          {/* Project selector placeholder */}
          <div className="rounded-md border border-dashed border-border p-4 text-center">
            <p className="text-sm text-muted-foreground">No project selected</p>
            <button className="mt-2 text-xs text-primary hover:underline">
              Open Project...
            </button>
          </div>

          {/* File tree placeholder */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Files
            </p>
            <div className="rounded-md bg-muted/50 p-4 text-center">
              <p className="text-xs text-muted-foreground">
                File tree will appear here
              </p>
            </div>
          </div>

          {/* Build status placeholder */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Build Status
            </p>
            <div className="rounded-md bg-muted/50 p-3">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-muted-foreground" />
                <span className="text-xs text-muted-foreground">No build</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

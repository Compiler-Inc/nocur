import { useState } from "react";

type SimulatorState = "disconnected" | "booting" | "running";

export const SimulatorPane = () => {
  const [state] = useState<SimulatorState>("running");
  const [screenshot] = useState<string | null>("/tmp/nocur-test-screenshot.png"); // Mock for now

  const stateConfig = {
    disconnected: { color: "bg-zinc-500", text: "No Simulator" },
    booting: { color: "bg-yellow-500 animate-pulse", text: "Booting..." },
    running: { color: "bg-green-500", text: "Running" },
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Header */}
      <div className="h-12 px-4 flex items-center justify-between border-b border-zinc-800 bg-zinc-900/50">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium text-zinc-300">Simulator</h2>
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${stateConfig[state].color}`} />
            <span className="text-xs text-zinc-500">{stateConfig[state].text}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="px-2 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors">
            Screenshot
          </button>
          <button className="px-2 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors">
            Hierarchy
          </button>
        </div>
      </div>

      {/* Simulator View */}
      <div className="flex-1 flex items-center justify-center p-4 bg-zinc-900/30">
        {state === "disconnected" ? (
          <div className="text-center space-y-4">
            <div className="w-48 h-96 rounded-3xl border-2 border-dashed border-zinc-700 flex items-center justify-center">
              <div className="text-center space-y-2 p-4">
                <div className="text-3xl text-zinc-700">◎</div>
                <p className="text-xs text-zinc-600">No simulator</p>
              </div>
            </div>
            <button className="px-4 py-2 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors">
              Boot Simulator
            </button>
          </div>
        ) : (
          <div className="relative">
            {/* Device frame */}
            <div className="relative rounded-[2.5rem] border-4 border-zinc-800 bg-black overflow-hidden shadow-2xl">
              {/* Notch */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-28 h-7 bg-black rounded-b-2xl z-10" />

              {/* Screen content */}
              <div className="w-[280px] h-[606px] bg-zinc-900">
                {screenshot ? (
                  <div className="w-full h-full flex items-center justify-center text-zinc-600">
                    {/* In real implementation, this would show the actual screenshot */}
                    <div className="text-center space-y-2">
                      <div className="text-2xl">📱</div>
                      <p className="text-xs">Live view</p>
                      <p className="text-[10px] text-zinc-700">Click to refresh</p>
                    </div>
                  </div>
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-zinc-600 text-xs">Loading...</span>
                  </div>
                )}
              </div>
            </div>

            {/* Device name */}
            <div className="mt-3 text-center">
              <span className="text-xs text-zinc-500 font-mono">iPhone 16 Pro</span>
            </div>
          </div>
        )}
      </div>

      {/* Bottom toolbar */}
      <div className="h-12 px-4 flex items-center justify-between border-t border-zinc-800 bg-zinc-900/50">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-600 font-mono">iOS 18.2</span>
          <span className="text-zinc-700">•</span>
          <span className="text-xs text-zinc-600 font-mono">1206×2622</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="p-2 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Tap"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="3" strokeWidth="2"/>
              <path strokeWidth="2" d="M12 2v4m0 12v4m10-10h-4M6 12H2"/>
            </svg>
          </button>
          <button
            className="p-2 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Scroll"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeWidth="2" strokeLinecap="round" d="M12 5v14m0-14l-3 3m3-3l3 3m-3 11l-3-3m3 3l3-3"/>
            </svg>
          </button>
          <button
            className="p-2 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Type"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <rect x="2" y="6" width="20" height="12" rx="2" strokeWidth="2"/>
              <path strokeWidth="2" d="M6 14h.01M10 14h.01M14 14h.01M18 14h.01M8 10h8"/>
            </svg>
          </button>
          <div className="w-px h-4 bg-zinc-800 mx-1"/>
          <button
            className="p-2 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Home"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <rect x="5" y="2" width="14" height="20" rx="3" strokeWidth="2"/>
              <circle cx="12" cy="18" r="1" fill="currentColor"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

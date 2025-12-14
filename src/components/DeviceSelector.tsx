import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

interface DeviceInfo {
  id: string;                    // UDID for xcodebuild
  coreDeviceId: string | null;   // CoreDevice UUID for devicectl (physical devices only)
  name: string;
  model: string;
  osVersion: string;
  deviceType: "simulator" | "physical";
  state: "booted" | "shutdown" | "connected" | "disconnected" | "unavailable";
  isAvailable: boolean;
}

interface DeviceListResult {
  devices: DeviceInfo[];
  simulatorCount: number;
  physicalCount: number;
}

interface DeviceSelectorProps {
  selectedDevice: DeviceInfo | null;
  onDeviceSelect: (device: DeviceInfo) => void;
  disabled?: boolean;
}

export const DeviceSelector = ({
  selectedDevice,
  onDeviceSelect,
  disabled = false,
}: DeviceSelectorProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Fetch devices when dropdown opens
  const handleOpen = async () => {
    if (disabled) return;
    
    setIsOpen(!isOpen);
    
    if (!isOpen) {
      setIsLoading(true);
      try {
        const result = await invoke<DeviceListResult>("list_devices");
        setDevices(result.devices);
      } catch (error) {
        console.error("Failed to list devices:", error);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleDeviceSelect = async (device: DeviceInfo) => {
    onDeviceSelect(device);
    setIsOpen(false);
    
    // Save selection to backend
    try {
      await invoke("set_selected_device", { device });
    } catch (error) {
      console.error("Failed to save device selection:", error);
    }
  };

  const handleRefresh = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsLoading(true);
    try {
      const result = await invoke<DeviceListResult>("list_devices");
      setDevices(result.devices);
    } catch (error) {
      console.error("Failed to refresh devices:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Group devices by type
  const simulators = devices.filter((d) => d.deviceType === "simulator");
  const physicalDevices = devices.filter((d) => d.deviceType === "physical");

  // Filter to show only relevant simulators (iPhones, booted first)
  const relevantSimulators = simulators
    .filter((d) => d.name.includes("iPhone"))
    .sort((a, b) => {
      // Booted first
      if (a.state === "booted" && b.state !== "booted") return -1;
      if (b.state === "booted" && a.state !== "booted") return 1;
      // Then by name
      return a.name.localeCompare(b.name);
    })
    .slice(0, 10); // Limit to 10 simulators

  const DeviceIcon = ({ type, state }: { type: string; state: string }) => {
    const isActive = state === "booted" || state === "connected";
    
    if (type === "physical") {
      return (
        <div className="relative">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <rect x="5" y="2" width="14" height="20" rx="2" strokeWidth="1.5" />
            <line x1="12" y1="18" x2="12" y2="18.01" strokeWidth="2" strokeLinecap="round" />
          </svg>
          {isActive && (
            <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-success rounded-full" />
          )}
        </div>
      );
    }
    
    return (
      <div className="relative">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <rect x="3" y="4" width="18" height="14" rx="2" strokeWidth="1.5" />
          <path d="M8 21h8M12 18v3" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        {isActive && (
          <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-success rounded-full" />
        )}
      </div>
    );
  };

  const StateIndicator = ({ state }: { state: string }) => {
    const config = {
      booted: { color: "bg-success", text: "Running" },
      connected: { color: "bg-success", text: "Connected" },
      shutdown: { color: "bg-text-tertiary", text: "Shutdown" },
      disconnected: { color: "bg-warning", text: "Disconnected" },
      unavailable: { color: "bg-error", text: "Unavailable" },
    }[state] || { color: "bg-text-tertiary", text: "Unknown" };

    return (
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${config.color}`} title={config.text} />
    );
  };

  return (
    <div className="relative" ref={dropdownRef} data-no-drag>
      {/* Trigger Button */}
      <button
        onClick={handleOpen}
        disabled={disabled}
        className={`
          flex items-center gap-2 px-2.5 py-1 text-xs rounded
          bg-surface-overlay hover:bg-hover
          text-text-primary transition-colors
          disabled:opacity-50 disabled:cursor-not-allowed
          border border-border
        `}
      >
        {selectedDevice ? (
          <>
            <DeviceIcon type={selectedDevice.deviceType} state={selectedDevice.state} />
            <span className="max-w-[120px] truncate">{selectedDevice.name}</span>
          </>
        ) : (
          <>
            <svg className="w-4 h-4 text-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <rect x="5" y="2" width="14" height="20" rx="2" strokeWidth="1.5" />
            </svg>
            <span className="text-text-tertiary">Select Device</span>
          </>
        )}
        <svg
          className={`w-3 h-3 text-text-tertiary transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeWidth="2" strokeLinecap="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-surface-raised border border-border rounded-lg shadow-lg z-50 overflow-hidden">
          {isLoading ? (
            <div className="p-4 text-center text-text-tertiary text-xs">
              Loading devices...
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {/* Physical Devices */}
              {physicalDevices.length > 0 && (
                <div>
                  <div className="px-3 py-2 text-[10px] font-medium text-text-tertiary uppercase tracking-wider bg-surface-sunken">
                    Physical Devices
                  </div>
                  {physicalDevices.map((device) => (
                    <button
                      key={device.id}
                      onClick={() => handleDeviceSelect(device)}
                      disabled={!device.isAvailable}
                      className={`
                        w-full flex items-center gap-2 px-3 py-2 text-left
                        hover:bg-hover transition-colors
                        disabled:opacity-50 disabled:cursor-not-allowed
                        ${selectedDevice?.id === device.id ? "bg-accent/10" : ""}
                      `}
                    >
                      <DeviceIcon type={device.deviceType} state={device.state} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-text-primary truncate">{device.name}</span>
                          <StateIndicator state={device.state} />
                        </div>
                        <div className="text-[10px] text-text-tertiary">
                          {device.model} - iOS {device.osVersion}
                        </div>
                      </div>
                      {selectedDevice?.id === device.id && (
                        <svg className="w-4 h-4 text-accent shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* Simulators */}
              {relevantSimulators.length > 0 && (
                <div>
                  <div className="px-3 py-2 text-[10px] font-medium text-text-tertiary uppercase tracking-wider bg-surface-sunken">
                    Simulators
                  </div>
                  {relevantSimulators.map((device) => (
                    <button
                      key={device.id}
                      onClick={() => handleDeviceSelect(device)}
                      className={`
                        w-full flex items-center gap-2 px-3 py-2 text-left
                        hover:bg-hover transition-colors
                        ${selectedDevice?.id === device.id ? "bg-accent/10" : ""}
                      `}
                    >
                      <DeviceIcon type={device.deviceType} state={device.state} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-text-primary truncate">{device.name}</span>
                          <StateIndicator state={device.state} />
                        </div>
                        <div className="text-[10px] text-text-tertiary">
                          iOS {device.osVersion}
                        </div>
                      </div>
                      {selectedDevice?.id === device.id && (
                        <svg className="w-4 h-4 text-accent shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* No devices */}
              {devices.length === 0 && (
                <div className="p-4 text-center text-text-tertiary text-xs">
                  No devices found
                </div>
              )}
            </div>
          )}

          {/* Footer with refresh */}
          <div className="border-t border-border px-3 py-2 flex items-center justify-between bg-surface-sunken">
            <span className="text-[10px] text-text-tertiary">
              {devices.length} device{devices.length !== 1 ? "s" : ""}
            </span>
            <button
              onClick={handleRefresh}
              disabled={isLoading}
              className="p-1 rounded hover:bg-hover text-text-tertiary hover:text-text-primary transition-colors disabled:opacity-50"
              title="Refresh devices"
            >
              <svg
                className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

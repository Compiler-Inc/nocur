import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useProject, CreateProjectRequest } from "@/lib/project-context";

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NewProjectModal = ({ isOpen, onClose }: NewProjectModalProps) => {
  const { createProject } = useProject();
  
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [bundleIdPrefix, setBundleIdPrefix] = useState("com.example");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setName("");
      setLocation("");
      setBundleIdPrefix("com.example");
      setError(null);
    }
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleSelectLocation = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Project Location",
      });
      if (selected && typeof selected === "string") {
        setLocation(selected);
      }
    } catch (err) {
      console.error("Failed to select location:", err);
    }
  };

  const validateName = (value: string): boolean => {
    if (!value) return false;
    if (value.length > 50) return false;
    // Must start with letter, only alphanumeric and hyphens
    return /^[A-Za-z][A-Za-z0-9-]*$/.test(value);
  };

  const handleCreate = async () => {
    setError(null);

    // Validate
    if (!name.trim()) {
      setError("Project name is required");
      return;
    }
    if (!validateName(name)) {
      setError("Project name must start with a letter and contain only letters, numbers, and hyphens");
      return;
    }
    if (!location.trim()) {
      setError("Please select a location for the project");
      return;
    }
    if (!bundleIdPrefix.trim()) {
      setError("Bundle ID prefix is required");
      return;
    }

    setIsCreating(true);
    try {
      const request: CreateProjectRequest = {
        name: name.trim(),
        location: location.trim(),
        bundleIdPrefix: bundleIdPrefix.trim(),
      };
      await createProject(request);
      onClose();
    } catch (err) {
      setError(typeof err === "string" ? err : "Failed to create project");
    } finally {
      setIsCreating(false);
    }
  };

  if (!isOpen) return null;

  const generatedBundleId = bundleIdPrefix + "." + name.toLowerCase().replace(/-/g, "");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-surface-raised border border-border rounded-xl shadow-2xl w-full max-w-md mx-4 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary">New Project</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-hover text-text-tertiary hover:text-text-primary transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4 space-y-4">
          {/* Project Name */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">
              Project Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="MyAwesomeApp"
              className="w-full px-3 py-2 bg-surface-overlay border border-border rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-colors"
              autoFocus
            />
            <p className="mt-1 text-xs text-text-tertiary">
              Letters, numbers, and hyphens only. Must start with a letter.
            </p>
          </div>

          {/* Location */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">
              Location
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="~/Developer"
                className="flex-1 px-3 py-2 bg-surface-overlay border border-border rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-colors font-mono text-sm"
                readOnly
              />
              <button
                onClick={handleSelectLocation}
                className="px-3 py-2 bg-surface-overlay border border-border rounded-lg text-text-secondary hover:bg-hover hover:text-text-primary transition-colors"
              >
                Browse...
              </button>
            </div>
          </div>

          {/* Bundle ID Prefix */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">
              Bundle ID Prefix
            </label>
            <input
              type="text"
              value={bundleIdPrefix}
              onChange={(e) => setBundleIdPrefix(e.target.value)}
              placeholder="com.example"
              className="w-full px-3 py-2 bg-surface-overlay border border-border rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-colors"
            />
            {name && (
              <p className="mt-1 text-xs text-text-tertiary">
                Bundle ID: <span className="font-mono text-accent">{generatedBundleId}</span>
              </p>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 bg-error/10 border border-error/30 rounded-lg">
              <p className="text-sm text-error">{error}</p>
            </div>
          )}

          {/* What will be created */}
          <div className="p-3 bg-surface-overlay rounded-lg border border-border">
            <p className="text-xs font-medium text-text-secondary mb-2">This will create:</p>
            <ul className="text-xs text-text-tertiary space-y-1">
              <li className="flex items-center gap-2">
                <span className="text-accent">•</span>
                A Tuist-managed SwiftUI project
              </li>
              <li className="flex items-center gap-2">
                <span className="text-accent">•</span>
                Project.swift and Tuist.swift manifests
              </li>
              <li className="flex items-center gap-2">
                <span className="text-accent">•</span>
                Basic app structure with ContentView
              </li>
              <li className="flex items-center gap-2">
                <span className="text-accent">•</span>
                CLAUDE.md with project documentation
              </li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            disabled={isCreating}
            className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={isCreating || !name || !location}
            className="px-4 py-2 text-sm font-medium bg-accent hover:bg-accent-muted text-surface-base rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isCreating ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Creating...
              </>
            ) : (
              "Create Project"
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

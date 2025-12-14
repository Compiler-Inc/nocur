import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

// Types matching the Rust ACE module
type BulletSection =
  | "strategies_and_hard_rules"
  | "useful_code_snippets"
  | "troubleshooting_and_pitfalls"
  | "apis_to_use_for_specific_information"
  | "verification_checklist"
  | "domain_glossary";

interface Bullet {
  id: string;
  projectId: string;
  section: BulletSection;
  content: string;
  helpfulCount: number;
  harmfulCount: number;
  neutralCount: number;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  active: boolean;
}

interface Playbook {
  projectId: string;
  projectPath: string;
  aceEnabled: boolean;
  maxBullets: number;
  maxTokens: number;
  bullets: Bullet[];
  createdAt: number;
  updatedAt: number;
}

interface ACEConfig {
  enabled: boolean;
  defaultMaxBullets: number;
  defaultMaxTokens: number;
  reflectorModel: string;
  curatorModel: string;
  autoReflect: boolean;
  autoCurate: boolean;
  similarityThreshold: number;
}

interface PlaybookModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectPath: string;
}

const SECTION_LABELS: Record<BulletSection, string> = {
  strategies_and_hard_rules: "Strategies & Rules",
  useful_code_snippets: "Code Snippets",
  troubleshooting_and_pitfalls: "Troubleshooting",
  apis_to_use_for_specific_information: "APIs & Tools",
  verification_checklist: "Verification",
  domain_glossary: "Glossary",
};

const SECTIONS: BulletSection[] = [
  "strategies_and_hard_rules",
  "useful_code_snippets",
  "troubleshooting_and_pitfalls",
  "apis_to_use_for_specific_information",
  "verification_checklist",
  "domain_glossary",
];

export const PlaybookModal = ({ isOpen, onClose, projectPath }: PlaybookModalProps) => {
  const [playbook, setPlaybook] = useState<Playbook | null>(null);
  const [_config, setConfig] = useState<ACEConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedSection, setSelectedSection] = useState<BulletSection>("strategies_and_hard_rules");
  const [selectedBullet, setSelectedBullet] = useState<Bullet | null>(null);
  const [showNewBulletForm, setShowNewBulletForm] = useState(false);
  const [newBulletContent, setNewBulletContent] = useState("");
  const [editingBulletId, setEditingBulletId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  // Fetch playbook when modal opens
  const fetchPlaybook = useCallback(async () => {
    setLoading(true);
    try {
      const pb = await invoke<Playbook>("ace_get_or_create_playbook", { projectPath });
      setPlaybook(pb);
    } catch (err) {
      console.error("Failed to fetch playbook:", err);
    }
    setLoading(false);
  }, [projectPath]);

  const fetchConfig = useCallback(async () => {
    try {
      const cfg = await invoke<ACEConfig>("ace_get_config");
      setConfig(cfg);
    } catch (err) {
      console.error("Failed to fetch ACE config:", err);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchPlaybook();
      fetchConfig();
    }
  }, [isOpen, fetchPlaybook, fetchConfig]);

  // Toggle ACE for this project
  const toggleACE = async () => {
    if (!playbook) return;
    try {
      await invoke("ace_set_enabled", { projectPath, enabled: !playbook.aceEnabled });
      await fetchPlaybook();
    } catch (err) {
      console.error("Failed to toggle ACE:", err);
    }
  };

  // Add new bullet
  const addBullet = async () => {
    if (!newBulletContent.trim()) return;
    try {
      await invoke("ace_add_bullet", {
        projectPath,
        section: selectedSection,
        content: newBulletContent.trim(),
      });
      setNewBulletContent("");
      setShowNewBulletForm(false);
      await fetchPlaybook();
    } catch (err) {
      console.error("Failed to add bullet:", err);
    }
  };

  // Update bullet
  const updateBullet = async (bulletId: string, content: string) => {
    try {
      await invoke("ace_update_bullet", {
        projectPath,
        bulletId,
        content: content.trim(),
      });
      setEditingBulletId(null);
      setEditContent("");
      await fetchPlaybook();
    } catch (err) {
      console.error("Failed to update bullet:", err);
    }
  };

  // Delete (deactivate) bullet
  const deleteBullet = async (bulletId: string) => {
    try {
      await invoke("ace_delete_bullet", { projectPath, bulletId });
      if (selectedBullet?.id === bulletId) {
        setSelectedBullet(null);
      }
      await fetchPlaybook();
    } catch (err) {
      console.error("Failed to delete bullet:", err);
    }
  };

  if (!isOpen) return null;

  // Group bullets by section
  const bulletsBySection: Partial<Record<BulletSection, Bullet[]>> = playbook?.bullets.reduce((acc, bullet) => {
    if (!bullet.active) return acc;
    if (!acc[bullet.section]) acc[bullet.section] = [];
    acc[bullet.section]!.push(bullet);
    return acc;
  }, {} as Partial<Record<BulletSection, Bullet[]>>) || {};

  const sectionBullets: Bullet[] = bulletsBySection[selectedSection] || [];
  const totalActiveBullets = playbook?.bullets.filter(b => b.active).length || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-surface-raised border border-border rounded-xl shadow-2xl w-[800px] max-w-[90vw] max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-overlay">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-sm font-semibold text-text-primary">ACE Playbook</h2>
              <p className="text-xs text-text-tertiary mt-0.5">
                {totalActiveBullets} bullets | {playbook?.aceEnabled ? "Enabled" : "Disabled"}
              </p>
            </div>
            {/* ACE Toggle */}
            <button
              onClick={toggleACE}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                playbook?.aceEnabled
                  ? "bg-success/20 text-success hover:bg-success/30"
                  : "bg-surface-sunken text-text-tertiary hover:bg-hover"
              }`}
            >
              {playbook?.aceEnabled ? "ACE On" : "ACE Off"}
            </button>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-hover text-text-tertiary hover:text-text-secondary transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-1 min-h-0">
          {/* Section sidebar */}
          <div className="w-56 border-r border-border flex flex-col bg-surface-base">
            <div className="p-2 space-y-1">
              {SECTIONS.map((section) => {
                const count = bulletsBySection[section]?.length || 0;
                return (
                  <button
                    key={section}
                    onClick={() => {
                      setSelectedSection(section);
                      setSelectedBullet(null);
                      setShowNewBulletForm(false);
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg transition-colors flex items-center justify-between ${
                      selectedSection === section
                        ? "bg-accent/20 text-accent"
                        : "hover:bg-hover text-text-secondary"
                    }`}
                  >
                    <span className="text-sm truncate">{SECTION_LABELS[section]}</span>
                    {count > 0 && (
                      <span className="text-xs bg-surface-overlay px-1.5 py-0.5 rounded">
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Stats */}
            <div className="mt-auto p-3 border-t border-border-subtle">
              <div className="text-xs text-text-tertiary space-y-1">
                <div className="flex justify-between">
                  <span>Max Bullets</span>
                  <span>{playbook?.maxBullets || 100}</span>
                </div>
                <div className="flex justify-between">
                  <span>Max Tokens</span>
                  <span>{playbook?.maxTokens || 8000}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Bullet list */}
          <div className="w-72 border-r border-border flex flex-col">
            <div className="p-2 border-b border-border-subtle">
              <button
                onClick={() => {
                  setSelectedBullet(null);
                  setShowNewBulletForm(true);
                  setEditingBulletId(null);
                }}
                className="w-full px-3 py-2 rounded-lg bg-accent/10 text-accent text-sm font-medium hover:bg-accent/20 transition-colors flex items-center justify-center gap-2"
              >
                <span>+</span>
                <span>Add Bullet</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {loading ? (
                <div className="text-center text-text-tertiary text-sm py-4">Loading...</div>
              ) : sectionBullets.length === 0 ? (
                <div className="text-center text-text-tertiary text-sm py-4">
                  No bullets in this section
                </div>
              ) : (
                <div className="space-y-1">
                  {sectionBullets.map((bullet) => (
                    <button
                      key={bullet.id}
                      onClick={() => {
                        setSelectedBullet(bullet);
                        setShowNewBulletForm(false);
                        setEditingBulletId(null);
                      }}
                      className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                        selectedBullet?.id === bullet.id
                          ? "bg-accent/20 text-accent"
                          : "hover:bg-hover text-text-secondary"
                      }`}
                    >
                      <div className="text-sm line-clamp-2">{bullet.content}</div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-xs text-success">+{bullet.helpfulCount}</span>
                        <span className="text-xs text-error">-{bullet.harmfulCount}</span>
                        <span className="text-xs text-text-tertiary ml-auto font-mono">
                          {bullet.id.slice(0, 8)}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Detail view */}
          <div className="flex-1 flex flex-col min-w-0">
            {showNewBulletForm ? (
              <div className="flex-1 p-4 space-y-4 overflow-y-auto">
                <h3 className="text-sm font-semibold text-text-primary">Add New Bullet</h3>
                <p className="text-xs text-text-tertiary">
                  Section: {SECTION_LABELS[selectedSection]}
                </p>

                <div className="flex-1">
                  <label className="block text-xs text-text-tertiary mb-1">Content</label>
                  <textarea
                    value={newBulletContent}
                    onChange={(e) => setNewBulletContent(e.target.value)}
                    placeholder="Write actionable advice for the agent..."
                    className="w-full h-32 px-3 py-2 rounded-lg bg-surface-sunken border border-border text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setShowNewBulletForm(false)}
                    className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-hover transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={addBullet}
                    disabled={!newBulletContent.trim()}
                    className="px-4 py-2 rounded-lg text-sm bg-accent text-white hover:bg-accent/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Add Bullet
                  </button>
                </div>
              </div>
            ) : selectedBullet ? (
              <div className="flex-1 flex flex-col min-h-0">
                <div className="px-4 py-3 border-b border-border-subtle bg-surface-base flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-text-tertiary">{selectedBullet.id}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-success">
                        Helpful: {selectedBullet.helpfulCount}
                      </span>
                      <span className="text-xs text-error">
                        Harmful: {selectedBullet.harmfulCount}
                      </span>
                      <span className="text-xs text-text-tertiary">
                        Neutral: {selectedBullet.neutralCount}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setEditingBulletId(selectedBullet.id);
                        setEditContent(selectedBullet.content);
                      }}
                      className="p-1.5 rounded hover:bg-hover text-text-tertiary hover:text-text-secondary transition-colors"
                      title="Edit"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => deleteBullet(selectedBullet.id)}
                      className="p-1.5 rounded hover:bg-error/20 text-text-tertiary hover:text-error transition-colors"
                      title="Delete"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4 bg-surface-base">
                  {editingBulletId === selectedBullet.id ? (
                    <div className="space-y-4">
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="w-full h-40 px-3 py-2 rounded-lg bg-surface-sunken border border-border text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => {
                            setEditingBulletId(null);
                            setEditContent("");
                          }}
                          className="px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:bg-hover transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => updateBullet(selectedBullet.id, editContent)}
                          className="px-3 py-1.5 rounded-lg text-sm bg-accent text-white hover:bg-accent/80 transition-colors"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-text-secondary whitespace-pre-wrap">
                      {selectedBullet.content}
                    </div>
                  )}

                  {selectedBullet.lastUsedAt && (
                    <div className="mt-4 pt-4 border-t border-border-subtle">
                      <span className="text-xs text-text-tertiary">
                        Last used: {new Date(selectedBullet.lastUsedAt).toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
                Select a bullet or add a new one
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

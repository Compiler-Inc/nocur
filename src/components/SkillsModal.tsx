import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface SkillInfo {
  name: string;
  path: string;
  content: string;
  location: "user" | "project";
}

interface SkillsModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeSkills: string[];
  projectPath: string;
}

export const SkillsModal = ({ isOpen, onClose, activeSkills, projectPath }: SkillsModalProps) => {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<SkillInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [showNewSkillForm, setShowNewSkillForm] = useState(false);
  const [newSkillName, setNewSkillName] = useState("");
  const [newSkillContent, setNewSkillContent] = useState("");
  const [newSkillLocation, setNewSkillLocation] = useState<"user" | "project">("project");

  // Fetch skills when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchSkills();
    }
  }, [isOpen, projectPath]);

  const fetchSkills = async () => {
    setLoading(true);
    try {
      const result = await invoke<SkillInfo[]>("list_skills", { projectPath });
      setSkills(result);
    } catch (err) {
      console.error("Failed to fetch skills:", err);
    }
    setLoading(false);
  };

  const openFolder = async (location: string) => {
    try {
      await invoke("open_skills_folder", { location, projectPath });
    } catch (err) {
      console.error("Failed to open folder:", err);
    }
  };

  const createSkill = async () => {
    if (!newSkillName.trim() || !newSkillContent.trim()) return;

    try {
      await invoke("create_skill", {
        name: newSkillName.trim(),
        content: newSkillContent.trim(),
        location: newSkillLocation,
        projectPath,
      });
      setShowNewSkillForm(false);
      setNewSkillName("");
      setNewSkillContent("");
      fetchSkills();
    } catch (err) {
      console.error("Failed to create skill:", err);
    }
  };

  if (!isOpen) return null;

  const isActive = (skillName: string) => activeSkills.includes(skillName);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-surface-raised border border-border rounded-xl shadow-2xl w-[700px] max-w-[90vw] max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-overlay">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Claude Code Skills</h2>
            <p className="text-xs text-text-tertiary mt-0.5">
              Skills are automatically used by Claude when relevant
            </p>
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
          {/* Skills list */}
          <div className="w-64 border-r border-border flex flex-col">
            <div className="p-3 border-b border-border-subtle">
              <button
                onClick={() => {
                  setSelectedSkill(null);
                  setShowNewSkillForm(true);
                }}
                className="w-full px-3 py-2 rounded-lg bg-accent/10 text-accent text-sm font-medium hover:bg-accent/20 transition-colors flex items-center justify-center gap-2"
              >
                <span>+</span>
                <span>New Skill</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {loading ? (
                <div className="text-center text-text-tertiary text-sm py-4">Loading...</div>
              ) : skills.length === 0 ? (
                <div className="text-center text-text-tertiary text-sm py-4">
                  No skills found
                </div>
              ) : (
                <div className="space-y-1">
                  {skills.map((skill) => (
                    <button
                      key={skill.path}
                      onClick={() => {
                        setSelectedSkill(skill);
                        setShowNewSkillForm(false);
                      }}
                      className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                        selectedSkill?.path === skill.path
                          ? "bg-accent/20 text-accent"
                          : "hover:bg-hover text-text-secondary"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {isActive(skill.name) && (
                          <span className="w-2 h-2 rounded-full bg-success" title="Active" />
                        )}
                        <span className="text-sm font-medium truncate flex-1">{skill.name}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          skill.location === "user"
                            ? "bg-surface-overlay text-text-tertiary"
                            : "bg-accent/10 text-accent"
                        }`}>
                          {skill.location}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Quick actions */}
            <div className="p-2 border-t border-border-subtle space-y-1">
              <button
                onClick={() => openFolder("user")}
                className="w-full text-left px-3 py-1.5 rounded text-xs text-text-tertiary hover:text-text-secondary hover:bg-hover transition-colors flex items-center gap-2"
              >
                <span>📁</span>
                <span>Open User Skills</span>
              </button>
              <button
                onClick={() => openFolder("project")}
                className="w-full text-left px-3 py-1.5 rounded text-xs text-text-tertiary hover:text-text-secondary hover:bg-hover transition-colors flex items-center gap-2"
              >
                <span>📂</span>
                <span>Open Project Skills</span>
              </button>
            </div>
          </div>

          {/* Detail view */}
          <div className="flex-1 flex flex-col min-w-0">
            {showNewSkillForm ? (
              <div className="flex-1 p-4 space-y-4 overflow-y-auto">
                <h3 className="text-sm font-semibold text-text-primary">Create New Skill</h3>

                <div>
                  <label className="block text-xs text-text-tertiary mb-1">Skill Name</label>
                  <input
                    type="text"
                    value={newSkillName}
                    onChange={(e) => setNewSkillName(e.target.value)}
                    placeholder="my-skill"
                    className="w-full px-3 py-2 rounded-lg bg-surface-sunken border border-border text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>

                <div>
                  <label className="block text-xs text-text-tertiary mb-1">Location</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setNewSkillLocation("project")}
                      className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                        newSkillLocation === "project"
                          ? "bg-accent text-white"
                          : "bg-surface-overlay text-text-secondary hover:bg-hover"
                      }`}
                    >
                      Project
                    </button>
                    <button
                      onClick={() => setNewSkillLocation("user")}
                      className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                        newSkillLocation === "user"
                          ? "bg-accent text-white"
                          : "bg-surface-overlay text-text-secondary hover:bg-hover"
                      }`}
                    >
                      User (Global)
                    </button>
                  </div>
                </div>

                <div className="flex-1">
                  <label className="block text-xs text-text-tertiary mb-1">Content (Markdown)</label>
                  <textarea
                    value={newSkillContent}
                    onChange={(e) => setNewSkillContent(e.target.value)}
                    placeholder="Write skill instructions in markdown..."
                    className="w-full h-48 px-3 py-2 rounded-lg bg-surface-sunken border border-border text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent resize-none font-mono"
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setShowNewSkillForm(false)}
                    className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-hover transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={createSkill}
                    disabled={!newSkillName.trim() || !newSkillContent.trim()}
                    className="px-4 py-2 rounded-lg text-sm bg-accent text-white hover:bg-accent/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Create Skill
                  </button>
                </div>
              </div>
            ) : selectedSkill ? (
              <div className="flex-1 flex flex-col min-h-0">
                <div className="px-4 py-3 border-b border-border-subtle bg-surface-base flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-text-primary">{selectedSkill.name}</h3>
                      {isActive(selectedSkill.name) && (
                        <span className="px-2 py-0.5 rounded-full bg-success/20 text-success text-xs">
                          Active
                        </span>
                      )}
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        selectedSkill.location === "user"
                          ? "bg-surface-overlay text-text-tertiary"
                          : "bg-accent/10 text-accent"
                      }`}>
                        {selectedSkill.location}
                      </span>
                    </div>
                    <p className="text-xs text-text-tertiary mt-1 truncate" title={selectedSkill.path}>
                      {selectedSkill.path}
                    </p>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-6 bg-surface-base">
                  <article className="prose prose-invert prose-sm max-w-none
                    prose-headings:text-text-primary prose-headings:font-semibold prose-headings:mb-3 prose-headings:mt-6 first:prose-headings:mt-0
                    prose-h1:text-xl prose-h1:border-b prose-h1:border-border-subtle prose-h1:pb-2
                    prose-h2:text-lg
                    prose-h3:text-base
                    prose-p:text-text-secondary prose-p:leading-relaxed prose-p:mb-4
                    prose-strong:text-text-primary prose-strong:font-semibold
                    prose-em:text-text-secondary prose-em:italic
                    prose-ul:my-3 prose-ul:space-y-1.5
                    prose-ol:my-3 prose-ol:space-y-1.5
                    prose-li:text-text-secondary prose-li:leading-relaxed
                    prose-code:text-accent prose-code:bg-surface-overlay prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:before:content-none prose-code:after:content-none
                    prose-pre:bg-surface-sunken prose-pre:rounded-lg prose-pre:p-4 prose-pre:overflow-x-auto
                    prose-blockquote:border-l-2 prose-blockquote:border-accent prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:text-text-tertiary
                    prose-a:text-accent prose-a:no-underline hover:prose-a:underline
                  ">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        h1: ({ children }) => <h1 className="text-xl font-semibold text-text-primary border-b border-border-subtle pb-2 mb-4 mt-0 first:mt-0">{children}</h1>,
                        h2: ({ children }) => <h2 className="text-lg font-semibold text-text-primary mt-6 mb-3">{children}</h2>,
                        h3: ({ children }) => <h3 className="text-base font-semibold text-text-primary mt-4 mb-2">{children}</h3>,
                        p: ({ children }) => <p className="text-text-secondary leading-relaxed mb-4">{children}</p>,
                        ul: ({ children }) => <ul className="list-disc list-outside ml-5 space-y-2 my-4 text-text-secondary">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal list-outside ml-5 space-y-2 my-4 text-text-secondary">{children}</ol>,
                        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                        strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
                        code: ({ className, children }) => {
                          const isBlock = className?.includes("language-");
                          if (isBlock) {
                            return <code className="block text-sm">{children}</code>;
                          }
                          return <code className="text-accent bg-surface-overlay px-1.5 py-0.5 rounded text-sm">{children}</code>;
                        },
                        pre: ({ children }) => <pre className="bg-surface-sunken rounded-lg p-4 overflow-x-auto my-4">{children}</pre>,
                        blockquote: ({ children }) => <blockquote className="border-l-2 border-accent pl-4 italic text-text-tertiary my-4">{children}</blockquote>,
                        a: ({ href, children }) => <a href={href} className="text-accent hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>,
                        hr: () => <hr className="border-border my-6" />,
                      }}
                    >
                      {selectedSkill.content}
                    </ReactMarkdown>
                  </article>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
                Select a skill to view details
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

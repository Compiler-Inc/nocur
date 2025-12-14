/**
 * ACE (Agentic Context Engineering) Type Definitions
 *
 * This module defines the core data structures for the ACE system:
 * - Playbook: A collection of reusable knowledge bullets
 * - Bullet: Individual pieces of advice, snippets, or rules
 * - Reflection: Analysis of agent trajectories
 * - CurationOp: Delta operations for playbook updates
 */

// Section types for organizing bullets
export type BulletSection =
  | "strategies_and_hard_rules"
  | "useful_code_snippets"
  | "troubleshooting_and_pitfalls"
  | "apis_to_use_for_specific_information"
  | "verification_checklist"
  | "domain_glossary";

export const BULLET_SECTIONS: BulletSection[] = [
  "strategies_and_hard_rules",
  "useful_code_snippets",
  "troubleshooting_and_pitfalls",
  "apis_to_use_for_specific_information",
  "verification_checklist",
  "domain_glossary",
];

export const SECTION_LABELS: Record<BulletSection, string> = {
  strategies_and_hard_rules: "Strategies and Hard Rules",
  useful_code_snippets: "Useful Code Snippets",
  troubleshooting_and_pitfalls: "Troubleshooting and Pitfalls",
  apis_to_use_for_specific_information: "APIs for Specific Information",
  verification_checklist: "Verification Checklist",
  domain_glossary: "Domain Glossary",
};

// Core Bullet structure
export interface Bullet {
  id: string;                    // Unique ID, e.g., "strat-000123"
  projectId: string;             // Hash of project path
  section: BulletSection;        // Category
  content: string;               // The actual advice/snippet/rule
  helpfulCount: number;          // Times marked as helpful
  harmfulCount: number;          // Times marked as harmful
  neutralCount: number;          // Times used but neither helpful nor harmful
  createdAt: number;             // Unix timestamp (ms)
  updatedAt: number;             // Unix timestamp (ms)
  lastUsedAt: number | null;     // Last time used in a run
  active: boolean;               // Whether to include in playbook
}

// Playbook structure (collection of bullets for a project)
export interface Playbook {
  projectId: string;             // Hash of project path
  projectPath: string;           // Original project path
  aceEnabled: boolean;           // Whether ACE is active for this project
  maxBullets: number;            // Max bullets before triggering refinement
  maxTokens: number;             // Max tokens for serialized playbook
  bullets: Bullet[];             // All bullets
  createdAt: number;             // Unix timestamp (ms)
  updatedAt: number;             // Unix timestamp (ms)
}

// Tag types for bullet feedback
export type BulletTag = "helpful" | "harmful" | "neutral";

// Bullet tag from Reflector output
export interface BulletTagEntry {
  id: string;                    // Bullet ID
  tag: BulletTag;                // How useful it was
}

// Reflector output structure
export interface ReflectionResult {
  reasoning: string;             // Overall reflection/explanation
  errorIdentification: string;   // What went wrong (if anything)
  rootCauseAnalysis: string;     // Why it happened
  correctApproach: string;       // What should be done next time
  keyInsight: string;            // Reusable strategy/insight
  bulletTags: BulletTagEntry[];  // Feedback on used bullets
}

// Stored reflection with metadata
export interface StoredReflection {
  id: string;                    // Unique ID
  projectId: string;             // Project this belongs to
  sessionId: string;             // Session that triggered this
  task: string;                  // Original task/question
  outcome: "success" | "failure" | "unknown";
  reflection: ReflectionResult;
  bulletsUsed: string[];         // IDs of bullets used in the run
  createdAt: number;             // Unix timestamp (ms)
}

// Curation operation types
export type CurationOpType = "ADD" | "UPDATE" | "DEACTIVATE" | "MERGE";

// Individual curation operation
export interface CurationOperation {
  type: CurationOpType;
  section?: BulletSection;       // For ADD
  content?: string;              // For ADD/UPDATE
  bulletId?: string;             // For UPDATE/DEACTIVATE
  mergeIntoId?: string;          // For MERGE
  mergeFromIds?: string[];       // For MERGE
}

// Curator output structure
export interface CurationResult {
  reasoning: string;             // Why these changes are needed
  operations: CurationOperation[];
}

// Configuration for ACE system
export interface ACEConfig {
  enabled: boolean;              // Global ACE toggle
  defaultMaxBullets: number;     // Default max bullets per playbook
  defaultMaxTokens: number;      // Default max tokens for playbook
  reflectorModel: string;        // Model to use for Reflector
  curatorModel: string;          // Model to use for Curator
  autoReflect: boolean;          // Auto-run Reflector after each session
  autoCurate: boolean;           // Auto-run Curator after Reflector
  similarityThreshold: number;   // Threshold for dedup (0-1)
}

// Default configuration
export const DEFAULT_ACE_CONFIG: ACEConfig = {
  enabled: true,
  defaultMaxBullets: 100,
  defaultMaxTokens: 8000,
  reflectorModel: "claude-sonnet-4-20250514",
  curatorModel: "claude-sonnet-4-20250514",
  autoReflect: false,
  autoCurate: false,
  similarityThreshold: 0.85,
};

// Run context for Reflector/Curator
export interface RunContext {
  task: string;                  // Original task/question
  trace: string;                 // Agent reasoning/tool logs
  finalAnswer: string;           // Final response
  outcome: "success" | "failure" | "unknown";
  bulletsUsed: string[];         // IDs of bullets used
  sessionId: string;             // Session ID
}

// Helper to generate bullet IDs
export function generateBulletId(section: BulletSection): string {
  const prefix = section.split("_")[0].substring(0, 4);
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `${prefix}-${timestamp}${random}`;
}

// Helper to create a new bullet
export function createBullet(
  projectId: string,
  section: BulletSection,
  content: string
): Bullet {
  const now = Date.now();
  return {
    id: generateBulletId(section),
    projectId,
    section,
    content,
    helpfulCount: 0,
    harmfulCount: 0,
    neutralCount: 0,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    active: true,
  };
}

// Helper to create a new playbook
export function createPlaybook(
  projectId: string,
  projectPath: string,
  config: ACEConfig = DEFAULT_ACE_CONFIG
): Playbook {
  const now = Date.now();
  return {
    projectId,
    projectPath,
    aceEnabled: config.enabled,
    maxBullets: config.defaultMaxBullets,
    maxTokens: config.defaultMaxTokens,
    bullets: [],
    createdAt: now,
    updatedAt: now,
  };
}

// Helper to compute usefulness score for sorting
export function computeUsefulnessScore(bullet: Bullet): number {
  const netScore = bullet.helpfulCount - bullet.harmfulCount;
  const recencyBonus = bullet.lastUsedAt
    ? Math.max(0, 1 - (Date.now() - bullet.lastUsedAt) / (7 * 24 * 60 * 60 * 1000)) // Decay over 7 days
    : 0;
  return netScore + recencyBonus * 0.5;
}

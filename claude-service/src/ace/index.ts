/**
 * ACE (Agentic Context Engineering) System
 *
 * Main entry point for the ACE system. Provides:
 * - Playbook management and rendering
 * - Reflector agent for trajectory analysis
 * - Curator agent for delta updates
 * - Integration helpers for the Generator
 */

// Re-export types
export * from "./types.js";

// Re-export playbook utilities
export {
  renderPlaybook,
  buildACESystemPromptAddition,
  extractUsedBullets,
  needsRefinement,
  PLAYBOOK_BEGIN,
  PLAYBOOK_END,
  estimateTokens,
} from "./playbook.js";

// Re-export reflector
export {
  runReflector,
  createStoredReflection,
  getHelpfulBullets,
  getHarmfulBullets,
} from "./reflector.js";

// Re-export curator
export {
  runCurator,
  validateOperations,
  countOperations,
} from "./curator.js";

import {
  Playbook,
  Bullet,
  BulletSection,
  ReflectionResult,
  CurationResult,
  RunContext,
  StoredReflection,
  ACEConfig,
  DEFAULT_ACE_CONFIG,
  createBullet,
} from "./types.js";
import { buildACESystemPromptAddition, extractUsedBullets, needsRefinement } from "./playbook.js";
import { runReflector, createStoredReflection } from "./reflector.js";
import { runCurator, validateOperations } from "./curator.js";

/**
 * ACE Manager - Main class for managing the ACE pipeline
 */
export class ACEManager {
  private config: ACEConfig;

  constructor(config: Partial<ACEConfig> = {}) {
    this.config = { ...DEFAULT_ACE_CONFIG, ...config };
  }

  /**
   * Check if ACE is enabled globally
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Check if ACE is enabled for a specific playbook
   */
  isEnabledForPlaybook(playbook: Playbook): boolean {
    return this.config.enabled && playbook.aceEnabled;
  }

  /**
   * Generate the system prompt addition for a playbook
   */
  getSystemPromptAddition(playbook: Playbook): {
    promptAddition: string;
    bulletsIncluded: string[];
  } | null {
    if (!this.isEnabledForPlaybook(playbook)) {
      return null;
    }

    if (playbook.bullets.length === 0) {
      return null;
    }

    const { promptAddition, bulletsIncluded } = buildACESystemPromptAddition(
      playbook,
      playbook.maxTokens
    );

    return { promptAddition, bulletsIncluded };
  }

  /**
   * Extract bullet IDs used from a Generator response
   */
  extractUsedBullets(response: string): string[] {
    return extractUsedBullets(response);
  }

  /**
   * Run the full reflection pipeline
   */
  async reflect(
    playbook: Playbook,
    context: RunContext
  ): Promise<{
    reflection: StoredReflection;
    bulletUpdates: Array<{ id: string; field: "helpful" | "harmful" | "neutral" }>;
  }> {
    // Get content of used bullets for context
    const usedBullets = playbook.bullets.filter((b) =>
      context.bulletsUsed.includes(b.id)
    );
    const bulletsContent = usedBullets
      .map((b) => `[${b.id}] ${b.content}`)
      .join("\n\n");

    // Run reflector
    const result = await runReflector(context, bulletsContent, this.config);

    // Create stored reflection
    const reflection = createStoredReflection(
      playbook.projectId,
      context,
      result
    );

    // Collect bullet updates
    const bulletUpdates = result.bulletTags.map((t) => ({
      id: t.id,
      field: t.tag as "helpful" | "harmful" | "neutral",
    }));

    return { reflection, bulletUpdates };
  }

  /**
   * Run the curation pipeline
   */
  async curate(
    playbook: Playbook,
    reflection: ReflectionResult,
    taskContext: string
  ): Promise<{
    result: CurationResult;
    validOperations: CurationResult["operations"];
    invalidCount: number;
  }> {
    // Run curator
    const result = await runCurator(playbook, reflection, taskContext, this.config);

    // Validate operations
    const { valid, invalid } = validateOperations(playbook, result.operations);

    if (invalid.length > 0) {
      console.warn("[ACE] Some operations were invalid:", invalid);
    }

    return {
      result,
      validOperations: valid,
      invalidCount: invalid.length,
    };
  }

  /**
   * Apply curation operations to a playbook (returns new playbook, doesn't mutate)
   */
  applyOperations(
    playbook: Playbook,
    operations: CurationResult["operations"]
  ): { updatedPlaybook: Playbook; appliedCount: number } {
    const bullets = [...playbook.bullets];
    let appliedCount = 0;
    const now = Date.now();

    for (const op of operations) {
      try {
        switch (op.type) {
          case "ADD":
            if (op.section && op.content) {
              const newBullet = createBullet(playbook.projectId, op.section, op.content);
              bullets.push(newBullet);
              appliedCount++;
            }
            break;

          case "UPDATE":
            if (op.bulletId && op.content) {
              const idx = bullets.findIndex((b) => b.id === op.bulletId);
              if (idx >= 0) {
                bullets[idx] = {
                  ...bullets[idx],
                  content: op.content,
                  updatedAt: now,
                };
                appliedCount++;
              }
            }
            break;

          case "DEACTIVATE":
            if (op.bulletId) {
              const idx = bullets.findIndex((b) => b.id === op.bulletId);
              if (idx >= 0) {
                bullets[idx] = {
                  ...bullets[idx],
                  active: false,
                  updatedAt: now,
                };
                appliedCount++;
              }
            }
            break;

          case "MERGE":
            if (op.mergeIntoId && op.mergeFromIds && op.content) {
              // Update target bullet
              const targetIdx = bullets.findIndex((b) => b.id === op.mergeIntoId);
              if (targetIdx >= 0) {
                bullets[targetIdx] = {
                  ...bullets[targetIdx],
                  content: op.content,
                  updatedAt: now,
                };
                // Deactivate source bullets
                for (const fromId of op.mergeFromIds) {
                  const fromIdx = bullets.findIndex((b) => b.id === fromId);
                  if (fromIdx >= 0) {
                    bullets[fromIdx] = {
                      ...bullets[fromIdx],
                      active: false,
                      updatedAt: now,
                    };
                  }
                }
                appliedCount++;
              }
            }
            break;
        }
      } catch (e) {
        console.error(`[ACE] Failed to apply operation ${op.type}:`, e);
      }
    }

    return {
      updatedPlaybook: {
        ...playbook,
        bullets,
        updatedAt: now,
      },
      appliedCount,
    };
  }

  /**
   * Check if playbook needs refinement and run basic deduplication
   */
  checkAndRefine(playbook: Playbook): {
    needsRefine: boolean;
    suggestions: string[];
  } {
    const suggestions: string[] = [];
    const needsRefine = needsRefinement(playbook);

    if (needsRefine) {
      const activeBullets = playbook.bullets.filter((b) => b.active);

      // Check for bullets with high harmful count
      const harmfulBullets = activeBullets.filter(
        (b) => b.harmfulCount > b.helpfulCount && b.harmfulCount >= 3
      );
      if (harmfulBullets.length > 0) {
        suggestions.push(
          `Consider deactivating ${harmfulBullets.length} bullets with high harmful counts`
        );
      }

      // Check for potential duplicates (simple string similarity)
      const potentialDupes = this.findPotentialDuplicates(activeBullets);
      if (potentialDupes.length > 0) {
        suggestions.push(
          `Found ${potentialDupes.length} potential duplicate pairs that could be merged`
        );
      }

      // Check for old, unused bullets
      const staleThreshold = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days
      const staleBullets = activeBullets.filter(
        (b) => !b.lastUsedAt || b.lastUsedAt < staleThreshold
      );
      if (staleBullets.length > 10) {
        suggestions.push(
          `${staleBullets.length} bullets haven't been used in 30+ days`
        );
      }
    }

    return { needsRefine, suggestions };
  }

  /**
   * Simple duplicate detection using normalized string comparison
   */
  private findPotentialDuplicates(
    bullets: Bullet[]
  ): Array<[Bullet, Bullet]> {
    const duplicates: Array<[Bullet, Bullet]> = [];
    const threshold = this.config.similarityThreshold;

    for (let i = 0; i < bullets.length; i++) {
      for (let j = i + 1; j < bullets.length; j++) {
        if (bullets[i].section !== bullets[j].section) continue;

        const similarity = this.stringSimilarity(
          bullets[i].content,
          bullets[j].content
        );
        if (similarity >= threshold) {
          duplicates.push([bullets[i], bullets[j]]);
        }
      }
    }

    return duplicates;
  }

  /**
   * Simple string similarity using Jaccard index on words
   */
  private stringSimilarity(a: string, b: string): number {
    const normalize = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/);

    const wordsA = new Set(normalize(a));
    const wordsB = new Set(normalize(b));

    const intersection = new Set([...wordsA].filter((x) => wordsB.has(x)));
    const union = new Set([...wordsA, ...wordsB]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }
}

/**
 * Create a default ACE manager instance
 */
export function createACEManager(config?: Partial<ACEConfig>): ACEManager {
  return new ACEManager(config);
}

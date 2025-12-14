/**
 * Playbook Rendering Service
 *
 * Handles serialization of playbooks for injection into the Generator's context.
 * Implements token-aware rendering with priority sorting.
 */

import {
  Playbook,
  Bullet,
  BulletSection,
  BULLET_SECTIONS,
  SECTION_LABELS,
  computeUsefulnessScore,
} from "./types.js";

// Markers for playbook block in context
export const PLAYBOOK_BEGIN = "PLAYBOOK_BEGIN";
export const PLAYBOOK_END = "PLAYBOOK_END";

// Approximate tokens per character (conservative estimate)
const CHARS_PER_TOKEN = 4;

/**
 * Estimate token count for a string
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Format a single bullet for display
 */
export function formatBullet(bullet: Bullet): string {
  const stats = `helpful=${bullet.helpfulCount} harmful=${bullet.harmfulCount}`;
  return `[${bullet.id}] ${stats} ::\n${bullet.content}`;
}

/**
 * Sort bullets by usefulness and recency
 */
export function sortBullets(bullets: Bullet[]): Bullet[] {
  return [...bullets].sort((a, b) => {
    // First by active status
    if (a.active !== b.active) return a.active ? -1 : 1;
    // Then by usefulness score
    return computeUsefulnessScore(b) - computeUsefulnessScore(a);
  });
}

/**
 * Group bullets by section
 */
export function groupBySection(bullets: Bullet[]): Map<BulletSection, Bullet[]> {
  const groups = new Map<BulletSection, Bullet[]>();

  // Initialize all sections
  for (const section of BULLET_SECTIONS) {
    groups.set(section, []);
  }

  // Group bullets
  for (const bullet of bullets) {
    const sectionBullets = groups.get(bullet.section) || [];
    sectionBullets.push(bullet);
    groups.set(bullet.section, sectionBullets);
  }

  return groups;
}

/**
 * Render a playbook to a string for injection into context.
 *
 * @param playbook - The playbook to render
 * @param maxTokens - Optional token budget override
 * @returns Object with rendered string and metadata
 */
export function renderPlaybook(
  playbook: Playbook,
  maxTokens?: number
): {
  rendered: string;
  tokenEstimate: number;
  bulletsIncluded: string[];
  bulletsTruncated: number;
} {
  const tokenBudget = maxTokens ?? playbook.maxTokens;

  // Get active bullets only
  const activeBullets = playbook.bullets.filter((b) => b.active);

  // Sort by usefulness
  const sortedBullets = sortBullets(activeBullets);

  // Group by section
  const grouped = groupBySection(sortedBullets);

  // Build rendered string incrementally, respecting token budget
  const lines: string[] = [PLAYBOOK_BEGIN, ""];
  const bulletsIncluded: string[] = [];
  let currentTokens = estimateTokens(PLAYBOOK_BEGIN + "\n\n" + PLAYBOOK_END);
  let bulletsTruncated = 0;

  for (const section of BULLET_SECTIONS) {
    const sectionBullets = grouped.get(section) || [];
    if (sectionBullets.length === 0) continue;

    const sectionHeader = `[Section: ${SECTION_LABELS[section]}]`;
    const headerTokens = estimateTokens(sectionHeader + "\n");

    // Check if we can fit the section header
    if (currentTokens + headerTokens > tokenBudget) {
      bulletsTruncated += sectionBullets.length;
      continue;
    }

    lines.push(sectionHeader);
    currentTokens += headerTokens;

    for (const bullet of sectionBullets) {
      const bulletText = formatBullet(bullet);
      const bulletTokens = estimateTokens(bulletText + "\n\n");

      if (currentTokens + bulletTokens > tokenBudget) {
        bulletsTruncated++;
        continue;
      }

      lines.push(bulletText);
      lines.push(""); // Blank line between bullets
      bulletsIncluded.push(bullet.id);
      currentTokens += bulletTokens;
    }
  }

  lines.push(PLAYBOOK_END);

  return {
    rendered: lines.join("\n"),
    tokenEstimate: currentTokens,
    bulletsIncluded,
    bulletsTruncated,
  };
}

/**
 * Generate instructions for the Generator to report which bullets it used.
 * This should be appended to the system prompt when ACE is enabled.
 */
export function getPlaybookUsageInstructions(): string {
  return `
When you complete a task, if you relied on any advice from the PLAYBOOK above, include a JSON block at the end of your final response listing the bullet IDs you found useful:

\`\`\`json
{"bullets_used": ["strat-abc123", "code-def456"]}
\`\`\`

Only include bullets that directly influenced your approach. If you didn't use any playbook advice, omit this block.
`.trim();
}

/**
 * Extract bullet IDs from a Generator response.
 * Looks for the JSON block with bullets_used.
 */
export function extractUsedBullets(response: string): string[] {
  const jsonPattern = /```json\s*\n?\s*\{[^}]*"bullets_used"\s*:\s*\[([^\]]*)\][^}]*\}\s*\n?\s*```/i;
  const match = response.match(jsonPattern);

  if (!match) return [];

  try {
    // Extract the array content and parse
    const arrayContent = match[1];
    const ids = arrayContent
      .split(",")
      .map((s) => s.trim().replace(/['"]/g, ""))
      .filter((s) => s.length > 0);
    return ids;
  } catch {
    return [];
  }
}

/**
 * Build the full system prompt addition for ACE.
 * Includes the playbook and usage instructions.
 */
export function buildACESystemPromptAddition(
  playbook: Playbook,
  maxTokens?: number
): {
  promptAddition: string;
  bulletsIncluded: string[];
  tokenEstimate: number;
} {
  const { rendered, bulletsIncluded, tokenEstimate } = renderPlaybook(
    playbook,
    maxTokens
  );

  const instructions = getPlaybookUsageInstructions();
  const instructionTokens = estimateTokens(instructions);

  const promptAddition = `
${rendered}

${instructions}
`.trim();

  return {
    promptAddition,
    bulletsIncluded,
    tokenEstimate: tokenEstimate + instructionTokens,
  };
}

/**
 * Check if a playbook needs refinement based on size limits.
 */
export function needsRefinement(playbook: Playbook): boolean {
  const activeBullets = playbook.bullets.filter((b) => b.active);

  // Check bullet count
  if (activeBullets.length > playbook.maxBullets) {
    return true;
  }

  // Check token budget
  const { tokenEstimate } = renderPlaybook(playbook);
  if (tokenEstimate > playbook.maxTokens * 0.9) {
    // 90% threshold
    return true;
  }

  return false;
}

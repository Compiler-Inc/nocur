/**
 * Curator Agent
 *
 * Transforms reflections into delta operations for playbook updates.
 * The Curator analyzes reflections and the current playbook state to
 * produce minimal, targeted updates (ADD, UPDATE, DEACTIVATE, MERGE).
 */

import Anthropic from "@anthropic-ai/sdk";
import type { TextBlock } from "@anthropic-ai/sdk/resources/messages";
import {
  CurationResult,
  CurationOperation,
  ReflectionResult,
  Playbook,
  BulletSection,
  BULLET_SECTIONS,
  ACEConfig,
  DEFAULT_ACE_CONFIG,
} from "./types.js";
import { renderPlaybook } from "./playbook.js";

// Curator system prompt
const CURATOR_SYSTEM_PROMPT = `You are a Curator agent in an Agentic Context Engineering (ACE) system. Your role is to maintain and improve a playbook of reusable knowledge based on reflections from agent executions.

You will be given:
1. The current playbook (a collection of bullets organized by section)
2. A reflection from a recent agent execution (analysis of what worked/didn't work)
3. The original task context

Your job is to propose DELTA OPERATIONS to update the playbook. You should NOT rewrite the entire playbook - only propose specific, targeted changes.

Available sections for bullets:
- strategies_and_hard_rules: General approaches and mandatory guidelines
- useful_code_snippets: Reusable code patterns
- troubleshooting_and_pitfalls: Common issues and how to avoid/fix them
- apis_to_use_for_specific_information: Which APIs/tools to use for what
- verification_checklist: Steps to verify work is correct
- domain_glossary: Domain-specific terms and definitions

Available operations:
- ADD: Create a new bullet in a section
- UPDATE: Modify an existing bullet's content (requires bulletId)
- DEACTIVATE: Mark a bullet as inactive (requires bulletId) - use for harmful/obsolete bullets
- MERGE: Combine multiple similar bullets into one (requires mergeIntoId and mergeFromIds)

Output your analysis as a JSON object with this exact structure:
{
  "reasoning": "Why these changes are needed...",
  "operations": [
    {
      "type": "ADD",
      "section": "strategies_and_hard_rules",
      "content": "The new bullet content..."
    },
    {
      "type": "UPDATE",
      "bulletId": "strat-abc123",
      "content": "The updated content..."
    },
    {
      "type": "DEACTIVATE",
      "bulletId": "code-xyz789"
    },
    {
      "type": "MERGE",
      "mergeIntoId": "trou-111",
      "mergeFromIds": ["trou-222", "trou-333"],
      "content": "The merged content..."
    }
  ]
}

Guidelines:
- Only propose changes when the reflection reveals genuinely useful insights
- Avoid adding duplicate or near-duplicate bullets
- Keep bullet content concise but actionable (1-3 sentences typically)
- Use DEACTIVATE for bullets that were repeatedly harmful
- Use MERGE when you see similar bullets that should be consolidated
- If no changes are needed, return an empty operations array
- Consider the helpful/harmful counts when deciding whether to modify bullets

IMPORTANT: Output ONLY the JSON object, no markdown code blocks or other text.`;

/**
 * Build the curator prompt from playbook and reflection
 */
function buildCuratorPrompt(
  playbook: Playbook,
  reflection: ReflectionResult,
  taskContext: string
): string {
  const { rendered } = renderPlaybook(playbook);

  return `## Current Playbook
${rendered}

## Recent Reflection
**Reasoning:** ${reflection.reasoning}

**Error Identification:** ${reflection.errorIdentification}

**Root Cause Analysis:** ${reflection.rootCauseAnalysis}

**Correct Approach:** ${reflection.correctApproach}

**Key Insight:** ${reflection.keyInsight}

**Bullet Feedback:**
${reflection.bulletTags.length > 0
    ? reflection.bulletTags.map(t => `- ${t.id}: ${t.tag}`).join("\n")
    : "No specific bullet feedback"}

## Original Task Context
${taskContext}

Based on this reflection, propose delta operations to improve the playbook.`;
}

/**
 * Parse the curator's JSON response
 */
function parseCuratorResponse(response: string): CurationResult {
  // Try to extract JSON from the response
  let jsonStr = response.trim();

  // Remove markdown code blocks if present
  if (jsonStr.startsWith("```json")) {
    jsonStr = jsonStr.slice(7);
  } else if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.slice(3);
  }
  if (jsonStr.endsWith("```")) {
    jsonStr = jsonStr.slice(0, -3);
  }
  jsonStr = jsonStr.trim();

  try {
    const parsed = JSON.parse(jsonStr);

    const result: CurationResult = {
      reasoning: String(parsed.reasoning || ""),
      operations: [],
    };

    // Parse operations
    const ops = parsed.operations || [];
    if (Array.isArray(ops)) {
      result.operations = ops
        .filter((op: unknown): op is Record<string, unknown> =>
          typeof op === "object" && op !== null && "type" in op
        )
        .map((op): CurationOperation | null => {
          const type = String(op.type).toUpperCase();

          switch (type) {
            case "ADD":
              if (!op.section || !op.content) return null;
              if (!BULLET_SECTIONS.includes(op.section as BulletSection)) return null;
              return {
                type: "ADD",
                section: op.section as BulletSection,
                content: String(op.content),
              };

            case "UPDATE":
              if (!op.bulletId || !op.content) return null;
              return {
                type: "UPDATE",
                bulletId: String(op.bulletId),
                content: String(op.content),
              };

            case "DEACTIVATE":
              if (!op.bulletId) return null;
              return {
                type: "DEACTIVATE",
                bulletId: String(op.bulletId),
              };

            case "MERGE":
              if (!op.mergeIntoId || !op.mergeFromIds || !op.content) return null;
              return {
                type: "MERGE",
                mergeIntoId: String(op.mergeIntoId),
                mergeFromIds: Array.isArray(op.mergeFromIds)
                  ? op.mergeFromIds.map(String)
                  : [],
                content: String(op.content),
              };

            default:
              return null;
          }
        })
        .filter((op): op is CurationOperation => op !== null);
    }

    return result;
  } catch (e) {
    console.error("[Curator] Failed to parse response:", e);
    return {
      reasoning: "Failed to parse curator response",
      operations: [],
    };
  }
}

/**
 * Run the Curator agent to propose playbook updates
 */
export async function runCurator(
  playbook: Playbook,
  reflection: ReflectionResult,
  taskContext: string,
  config: ACEConfig = DEFAULT_ACE_CONFIG
): Promise<CurationResult> {
  const client = new Anthropic();

  const prompt = buildCuratorPrompt(playbook, reflection, taskContext);

  console.log("[Curator] Proposing updates for playbook:", playbook.projectId);
  console.log("[Curator] Current bullet count:", playbook.bullets.length);

  try {
    const response = await client.messages.create({
      model: config.curatorModel,
      max_tokens: 2000,
      system: CURATOR_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    // Extract text from response
    const textContent = response.content.find((c): c is TextBlock => c.type === "text");
    if (!textContent) {
      throw new Error("No text content in curator response");
    }

    const result = parseCuratorResponse(textContent.text);

    console.log("[Curator] Analysis complete");
    console.log("[Curator] Operations proposed:", result.operations.length);
    for (const op of result.operations) {
      console.log(`[Curator]   - ${op.type}: ${op.section || op.bulletId || "merge"}`);
    }

    return result;
  } catch (error) {
    console.error("[Curator] Error proposing updates:", error);
    throw error;
  }
}

/**
 * Validate that proposed operations are safe to apply
 */
export function validateOperations(
  playbook: Playbook,
  operations: CurationOperation[]
): { valid: CurationOperation[]; invalid: Array<{ op: CurationOperation; reason: string }> } {
  const valid: CurationOperation[] = [];
  const invalid: Array<{ op: CurationOperation; reason: string }> = [];

  const bulletIds = new Set(playbook.bullets.map((b) => b.id));

  for (const op of operations) {
    switch (op.type) {
      case "ADD":
        if (!op.section || !op.content) {
          invalid.push({ op, reason: "ADD requires section and content" });
        } else if (op.content.length < 10) {
          invalid.push({ op, reason: "Content too short (min 10 chars)" });
        } else if (op.content.length > 2000) {
          invalid.push({ op, reason: "Content too long (max 2000 chars)" });
        } else {
          valid.push(op);
        }
        break;

      case "UPDATE":
        if (!op.bulletId || !op.content) {
          invalid.push({ op, reason: "UPDATE requires bulletId and content" });
        } else if (!bulletIds.has(op.bulletId)) {
          invalid.push({ op, reason: `Bullet ${op.bulletId} not found` });
        } else {
          valid.push(op);
        }
        break;

      case "DEACTIVATE":
        if (!op.bulletId) {
          invalid.push({ op, reason: "DEACTIVATE requires bulletId" });
        } else if (!bulletIds.has(op.bulletId)) {
          invalid.push({ op, reason: `Bullet ${op.bulletId} not found` });
        } else {
          valid.push(op);
        }
        break;

      case "MERGE":
        if (!op.mergeIntoId || !op.mergeFromIds || !op.content) {
          invalid.push({ op, reason: "MERGE requires mergeIntoId, mergeFromIds, and content" });
        } else if (!bulletIds.has(op.mergeIntoId)) {
          invalid.push({ op, reason: `Target bullet ${op.mergeIntoId} not found` });
        } else {
          const missingFrom = op.mergeFromIds.filter((id) => !bulletIds.has(id));
          if (missingFrom.length > 0) {
            invalid.push({ op, reason: `Source bullets not found: ${missingFrom.join(", ")}` });
          } else {
            valid.push(op);
          }
        }
        break;

      default:
        invalid.push({ op, reason: `Unknown operation type` });
    }
  }

  return { valid, invalid };
}

/**
 * Count operations by type
 */
export function countOperations(
  operations: CurationOperation[]
): Record<string, number> {
  const counts: Record<string, number> = {
    ADD: 0,
    UPDATE: 0,
    DEACTIVATE: 0,
    MERGE: 0,
  };

  for (const op of operations) {
    counts[op.type] = (counts[op.type] || 0) + 1;
  }

  return counts;
}

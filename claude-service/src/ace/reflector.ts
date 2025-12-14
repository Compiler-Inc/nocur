/**
 * Reflector Agent
 *
 * Analyzes agent trajectories and outcomes to produce structured insights.
 * The Reflector takes a run context (task, trace, outcome) and produces
 * a ReflectionResult with error analysis and bullet feedback.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { TextBlock } from "@anthropic-ai/sdk/resources/messages";
import {
  ReflectionResult,
  BulletTagEntry,
  RunContext,
  StoredReflection,
  ACEConfig,
  DEFAULT_ACE_CONFIG,
} from "./types.js";

// Reflector system prompt
const REFLECTOR_SYSTEM_PROMPT = `You are a Reflector agent in an Agentic Context Engineering (ACE) system. Your role is to analyze agent execution traces and outcomes to identify patterns, errors, and insights that can improve future performance.

You will be given:
1. The original task/question the agent was asked to solve
2. The agent's reasoning trace and tool calls
3. The final answer produced
4. The outcome (success, failure, or unknown)
5. A list of playbook bullet IDs the agent reported using (if any)

Your job is to:
1. Analyze what went well or poorly in the execution
2. Identify the root cause of any errors
3. Determine what approach should be taken next time
4. Extract reusable insights that could help in similar situations
5. Tag which playbook bullets (if any) were helpful, harmful, or neutral

Output your analysis as a JSON object with this exact structure:
{
  "reasoning": "Your overall analysis of the execution...",
  "errorIdentification": "What specific error or issue occurred (or 'None' if successful)...",
  "rootCauseAnalysis": "Why the error happened / what led to success...",
  "correctApproach": "What should be done differently next time...",
  "keyInsight": "A reusable strategy or lesson learned...",
  "bulletTags": [
    {"id": "bullet-id-1", "tag": "helpful"},
    {"id": "bullet-id-2", "tag": "harmful"}
  ]
}

Rules:
- bulletTags should only contain bullets that were actually used (from the provided list)
- Use "helpful" if the bullet contributed to success or good decisions
- Use "harmful" if the bullet led to errors or poor decisions
- Use "neutral" if the bullet was used but had no clear positive or negative impact
- Keep reasoning concise but actionable
- Focus on patterns that could apply to similar tasks
- If the outcome is "unknown", make your best assessment based on the trace

IMPORTANT: Output ONLY the JSON object, no markdown code blocks or other text.`;

/**
 * Build the reflector prompt from run context
 */
function buildReflectorPrompt(context: RunContext, bulletsContent: string): string {
  return `## Task
${context.task}

## Agent Trace
${context.trace}

## Final Answer
${context.finalAnswer}

## Outcome
${context.outcome}

## Playbook Bullets Used
${context.bulletsUsed.length > 0 ? context.bulletsUsed.join(", ") : "None reported"}

${bulletsContent ? `## Bullet Content Reference\n${bulletsContent}` : ""}

Analyze this execution and provide your structured reflection.`;
}

/**
 * Parse the reflector's JSON response
 */
function parseReflectorResponse(response: string): ReflectionResult {
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

    // Validate required fields
    const result: ReflectionResult = {
      reasoning: String(parsed.reasoning || ""),
      errorIdentification: String(parsed.errorIdentification || parsed.error_identification || ""),
      rootCauseAnalysis: String(parsed.rootCauseAnalysis || parsed.root_cause_analysis || ""),
      correctApproach: String(parsed.correctApproach || parsed.correct_approach || ""),
      keyInsight: String(parsed.keyInsight || parsed.key_insight || ""),
      bulletTags: [],
    };

    // Parse bullet tags
    const tags = parsed.bulletTags || parsed.bullet_tags || [];
    if (Array.isArray(tags)) {
      result.bulletTags = tags
        .filter((t: unknown): t is { id: string; tag: string } =>
          typeof t === "object" &&
          t !== null &&
          "id" in t &&
          "tag" in t
        )
        .map((t) => ({
          id: String(t.id),
          tag: t.tag as "helpful" | "harmful" | "neutral",
        }))
        .filter((t) => ["helpful", "harmful", "neutral"].includes(t.tag));
    }

    return result;
  } catch (e) {
    // Return a default result if parsing fails
    console.error("[Reflector] Failed to parse response:", e);
    return {
      reasoning: "Failed to parse reflector response",
      errorIdentification: "Parsing error",
      rootCauseAnalysis: response.substring(0, 500),
      correctApproach: "",
      keyInsight: "",
      bulletTags: [],
    };
  }
}

/**
 * Run the Reflector agent on a completed execution
 */
export async function runReflector(
  context: RunContext,
  bulletsContent: string = "",
  config: ACEConfig = DEFAULT_ACE_CONFIG
): Promise<ReflectionResult> {
  const client = new Anthropic();

  const prompt = buildReflectorPrompt(context, bulletsContent);

  console.log("[Reflector] Running analysis for session:", context.sessionId);
  console.log("[Reflector] Outcome:", context.outcome);
  console.log("[Reflector] Bullets used:", context.bulletsUsed.length);

  try {
    const response = await client.messages.create({
      model: config.reflectorModel,
      max_tokens: 2000,
      system: REFLECTOR_SYSTEM_PROMPT,
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
      throw new Error("No text content in reflector response");
    }

    const result = parseReflectorResponse(textContent.text);

    console.log("[Reflector] Analysis complete");
    console.log("[Reflector] Error identified:", result.errorIdentification.substring(0, 100));
    console.log("[Reflector] Bullet tags:", result.bulletTags.length);

    return result;
  } catch (error) {
    console.error("[Reflector] Error running analysis:", error);
    throw error;
  }
}

/**
 * Create a stored reflection from a reflection result
 */
export function createStoredReflection(
  projectId: string,
  context: RunContext,
  result: ReflectionResult
): StoredReflection {
  return {
    id: `ref-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
    projectId,
    sessionId: context.sessionId,
    task: context.task,
    outcome: context.outcome,
    reflection: result,
    bulletsUsed: context.bulletsUsed,
    createdAt: Date.now(),
  };
}

/**
 * Extract bullet IDs that were tagged as helpful
 */
export function getHelpfulBullets(result: ReflectionResult): string[] {
  return result.bulletTags
    .filter((t) => t.tag === "helpful")
    .map((t) => t.id);
}

/**
 * Extract bullet IDs that were tagged as harmful
 */
export function getHarmfulBullets(result: ReflectionResult): string[] {
  return result.bulletTags
    .filter((t) => t.tag === "harmful")
    .map((t) => t.id);
}

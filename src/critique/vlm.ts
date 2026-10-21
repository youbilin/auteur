import fs from "node:fs";
import { z } from "zod";
import type { QAIssue, VideoPlan } from "../plans/schema.js";
import type { ModelRegistry } from "../models/registry.js";
import { extractJson } from "../models/client.js";
import { log } from "../core/log.js";

const VlmIssueSchema = z.object({
  severity: z.enum(["major", "minor"]).default("minor"),
  atMs: z.number().min(0).optional(),
  sceneId: z.string().optional(),
  code: z.string().max(60).default("vlm_note"),
  message: z.string().max(320),
});

const VlmReviewSchema = z.object({
  score: z.number().min(0).max(100).optional(),
  summary: z.string().max(400).optional(),
  issues: z.array(VlmIssueSchema).max(10).default([]),
});

export interface VlmReviewResult {
  issues: QAIssue[];
  score?: number;
  notes: string[];
}

export async function reviewWithVlm(
  contactSheet: string | undefined,
  plan: VideoPlan,
  registry: ModelRegistry | undefined,
): Promise<VlmReviewResult> {
  if (!contactSheet || !fs.existsSync(contactSheet)) {
    return { issues: [], notes: ["VLM review skipped: no contact sheet."] };
  }
  if (!registry) {
    return { issues: [], notes: ["VLM review skipped: no model registry."] };
  }

  const base64 = fs.readFileSync(contactSheet).toString("base64");
  const prompt = [
    "You are a senior motion design critic reviewing a product/UI film.",
    "The image is a 2x2 contact sheet of the film's key frames.",
    "Judge only what is visible: composition, hierarchy, typography, brand consistency, and whether it looks like generic AI slop.",
    "Do not invent product facts or claim technical issues you cannot see.",
    'Return JSON only: {"score":0-100,"summary":"one sentence","issues":[{"severity":"major|minor","atMs":0,"code":"short_code","message":"specific, actionable"}]}.',
    "At most 5 issues. If it looks good, return an empty issues array. No markdown.",
  ].join("\n");

  const response = await registry.callVision(
    [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } },
        ],
      },
    ],
    { temperature: 0.2, maxTokens: 3000 },
  );
  if (!response) {
    return { issues: [], notes: ["VLM review skipped: no vision-capable model responded."] };
  }

  try {
    const parsed = VlmReviewSchema.parse(extractJson(response.content));
    const issues: QAIssue[] = parsed.issues.map((issue, index) => ({
      id: `vlm-${index + 1}`,
      critic: "vlm",
      severity: issue.severity,
      atMs: Math.round(issue.atMs ?? 0),
      ...(issue.sceneId && plan.scenes.some((scene) => scene.id === issue.sceneId)
        ? { sceneId: issue.sceneId }
        : {}),
      code: issue.code,
      message: `VLM: ${issue.message}`,
    }));
    return {
      issues,
      ...(parsed.score !== undefined ? { score: parsed.score } : {}),
      notes: parsed.summary ? [`VLM: ${parsed.summary}`] : [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`VLM review returned invalid JSON: ${message}`);
    return { issues: [], notes: [`VLM review unavailable: ${message.slice(0, 240)}`] };
  }
}

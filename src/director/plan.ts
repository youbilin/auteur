import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { VideoPlanBaseSchema, type VideoPlan } from "../plans/schema.js";
import { normalizePlan } from "../plans/validate.js";
import { formatZodError } from "../plans/validate.js";
import type { ModelRegistry } from "../models/registry.js";
import type { ChatMessage } from "../models/client.js";
import { AuteurError } from "../core/errors.js";
import { PROJECT_ROOT } from "../core/paths.js";

const fallbackSystemPrompt = `You are Auteur, a motion graphics director. Output only a valid VideoPlan JSON for a 2–4 scene product/UI motion graphics video. Use the schema from config/tokens.base.json and the template product-ui. No HTML, CSS, commentary, emoji, purple gradients, or glassmorphism.`;

function loadDirectorPrompt(): string {
  const candidates = [
    path.join(PROJECT_ROOT, "src", "models", "prompts", "director.md"),
    path.join(PROJECT_ROOT, "dist", "models", "prompts", "director.md"),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  }
  return fallbackSystemPrompt;
}

export interface DirectorOptions {
  brief: string;
  ratio?: "16:9" | "9:16";
  id?: string;
  extraInstruction?: string;
}

export async function createVideoPlan(
  registry: ModelRegistry,
  options: DirectorOptions,
): Promise<{ plan: VideoPlan; raw: string }> {
  const ratio = options.ratio ?? "16:9";
  const system = loadDirectorPrompt();
  const shapeInstruction = ratio === "9:16"
    ? "Use a phone device in every scene and design for a vertical 9:16 frame."
    : "Use a laptop device in every scene and design for a horizontal 16:9 frame.";

  const user = `BRIEF:\n${options.brief}\n\nFRAME: ${ratio}. ${shapeInstruction}${options.extraInstruction ? `\n\nADDITIONAL DIRECTION:\n${options.extraInstruction}` : ""}\n\nReturn the VideoPlan JSON now.`;
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const draft = await registry.callJson("director", messages, VideoPlanBaseSchema);
      try {
        return {
          plan: normalizePlan(draft, { id: options.id }),
          raw: JSON.stringify(draft),
        };
      } catch (error) {
        lastError = error;
        const detail =
          error instanceof z.ZodError
            ? formatZodError(error)
            : error instanceof Error
              ? error.message
              : String(error);
        messages.push({
          role: "user",
          content:
            `The previous plan failed validation:\n${detail}\n` +
            "Return a complete corrected plan. Keep 2–4 scenes and a total duration between 8000 and 15000 ms.",
        });
      }
    } catch (error) {
      throw new AuteurError(
        `Director failed to produce a valid plan: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }

  throw new AuteurError(
    `Director failed validation after 2 attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    lastError,
  );
}

export async function repairVideoPlan(
  registry: ModelRegistry,
  plan: VideoPlan,
  issues: string,
): Promise<VideoPlan> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You repair VideoPlan JSON. Return only a complete corrected plan. Preserve the creative intent; fix the reported issues.",
    },
    {
      role: "user",
      content: `PLAN:\n${JSON.stringify(plan, null, 2)}\n\nISSUES:\n${issues}\n\nReturn the corrected plan.`,
    },
  ];
  const draft = await registry.callJson("director", messages, VideoPlanBaseSchema);
  try {
    return normalizePlan(draft, { id: plan.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new AuteurError(`Repaired plan is still invalid:\n${formatZodError(error)}`, error);
    }
    throw error;
  }
}

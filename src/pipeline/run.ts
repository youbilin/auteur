import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { attachAudio, loadAudioConfig } from "../audio/mix.js";
import { synthesizeVoice } from "../audio/tts.js";
import { TEMPLATE_VERSION } from "../templates/product-ui/template.js";
import { writeComposition } from "../compose/html.js";
import { log } from "../core/log.js";
import {
  PROJECT_ROOT,
  ensureDir,
  outDir,
  readJson,
  runDir,
  slugify,
  writeJson,
} from "../core/paths.js";
import { createVideoPlan } from "../director/plan.js";
import { applyDeterministicFixes } from "../fix/fixer.js";
import { buildRegistry } from "../models/registry.js";
import { VideoPlanSchema, type QAReport, type VideoPlan } from "../plans/schema.js";
import { normalizePlan } from "../plans/validate.js";
import { reviewRun as runCritics } from "../critique/index.js";
import { renderWithHyperFrames } from "../render/hyperframes.js";

export type Quality = "draft" | "looks" | "delivery";

export function ensureRun(runId: string): void {
  ensureDir(runDir(runId));
}

export function readPlanFile(file: string): VideoPlan {
  const raw = readJson<unknown>(path.resolve(PROJECT_ROOT, file));
  const id =
    raw && typeof raw === "object" && "id" in raw && typeof (raw as { id?: unknown }).id === "string"
      ? (raw as { id: string }).id
      : path.basename(file, ".json");
  return normalizePlan(raw, { id: slugify(id) });
}

export function readRunPlan(runId: string): VideoPlan {
  const file = path.join(runDir(runId), "plan.json");
  if (!fs.existsSync(file)) {
    throw new Error(`No plan.json in ${runDir(runId)}. Generate a plan first.`);
  }
  const raw = readJson<unknown>(file);
  const id =
    raw && typeof raw === "object" && "id" in raw && typeof (raw as { id?: unknown }).id === "string"
      ? (raw as { id: string }).id
      : runId;
  return normalizePlan(raw, { id: slugify(id) });
}

export function writeRunPlan(runId: string, plan: VideoPlan): void {
  ensureRun(runId);
  writeJson(path.join(runDir(runId), "plan.json"), plan);
}

export function videoPath(runId: string, fixed = false): string {
  return path.join(outDir(runId), fixed ? "video.fixed.mp4" : "video.mp4");
}

export function validateQuality(value: string): Quality {
  return value === "draft" || value === "delivery" ? value : "looks";
}

function renderHash(
  runId: string,
  plan: VideoPlan,
  options: RenderRunOptions,
): { hash: string; voiceFile: string } {
  const voiceFile = path.join(runDir(runId), "voice.wav");
  const hash = crypto.createHash("sha256");
  hash.update(JSON.stringify(plan));
  hash.update(`template:${TEMPLATE_VERSION}`);
  hash.update(`quality:${options.quality}`);
  hash.update(`fixed:${Boolean(options.fixed)}`);
  hash.update(JSON.stringify(loadAudioConfig()));
  if (fs.existsSync(voiceFile)) {
    const stat = fs.statSync(voiceFile);
    hash.update(`voice:${stat.size}:${stat.mtimeMs}`);
  }
  return { hash: hash.digest("hex").slice(0, 24), voiceFile };
}

export interface RenderRunOptions {
  quality: Quality;
  fixed?: boolean;
  force?: boolean;
}

export function renderRun(
  runId: string,
  plan: VideoPlan,
  options: RenderRunOptions,
): string {
  const output = videoPath(runId, options.fixed);
  const hashFile = path.join(runDir(runId), options.fixed ? "render.fixed.hash" : "render.hash");
  const { hash, voiceFile } = renderHash(runId, plan, options);

  if (!options.force && fs.existsSync(output) && fs.existsSync(hashFile)) {
    const cachedHash = fs.readFileSync(hashFile, "utf8").trim();
    if (cachedHash === hash) {
      log.info(`Render cache hit: ${output}`);
      return output;
    }
  }

  const artifacts = writeComposition(runId, plan);
  const silent = output.replace(/\.mp4$/, ".silent.mp4");
  const result = renderWithHyperFrames({
    compositionDir: artifacts.dir,
    outFile: silent,
    fps: plan.fps,
    width: plan.width,
    height: plan.height,
    quality: options.quality,
  });

  let audio:
    | { attached: true; events: number; targetLufs: number }
    | { attached: false; reason: string } = { attached: false, reason: "disabled" };

  if (loadAudioConfig().enabled) {
    try {
      const mixed = attachAudio({
        runId,
        plan,
        silentVideo: silent,
        outputVideo: output,
        suffix: options.fixed ? "fixed" : undefined,
        ...(fs.existsSync(voiceFile) ? { voiceFile } : {}),
      });
      audio = {
        attached: true,
        events: mixed.events.length,
        targetLufs: mixed.config.targetLufs,
      };
    } catch (error) {
      audio = {
        attached: false,
        reason: error instanceof Error ? error.message : String(error),
      };
      log.warn(`Audio mix failed; keeping silent video. ${audio.reason}`);
      fs.copyFileSync(silent, output);
    }
  } else {
    fs.copyFileSync(silent, output);
  }

  fs.writeFileSync(hashFile, hash, "utf8");
  writeJson(path.join(runDir(runId), "render.json"), {
    ...result,
    outFile: output,
    silent,
    audio,
    hash,
    cached: false,
    composition: artifacts.dir,
    html: artifacts.htmlPath,
  });
  log.info(`Video: ${output}`);
  return output;
}

export async function reviewVideo(
  runId: string,
  plan: VideoPlan,
  video: string,
  options: { registry?: ReturnType<typeof buildRegistry> } = {},
): Promise<QAReport> {
  return runCritics({
    runId,
    plan,
    videoPath: video,
    ...(options.registry ? { registry: options.registry } : {}),
  });
}

export interface VoiceoverResult {
  voiceFile: string;
  video: string;
}

export function addVoiceover(
  runId: string,
  text: string,
  options: { voice?: string; rate?: number } = {},
): VoiceoverResult {
  const plan = readRunPlan(runId);
  const silent = videoPath(runId).replace(/\.mp4$/, ".silent.mp4");
  if (!fs.existsSync(silent)) {
    throw new Error(`No silent video in ${runDir(runId)}. Render the video first.`);
  }
  const voiceFile = path.join(runDir(runId), "voice.wav");
  synthesizeVoice(text, voiceFile, options);
  fs.writeFileSync(path.join(runDir(runId), "voice.txt"), text.trim(), "utf8");

  const output = videoPath(runId);
  const mixed = attachAudio({
    runId,
    plan,
    silentVideo: silent,
    outputVideo: output,
    voiceFile,
  });
  const renderFile = path.join(runDir(runId), "render.json");
  if (fs.existsSync(renderFile)) {
    const current = readJson<Record<string, unknown>>(renderFile);
    writeJson(renderFile, {
      ...current,
      outFile: output,
      audio: {
        attached: true,
        events: mixed.events.length,
        targetLufs: mixed.config.targetLufs,
        voice: true,
      },
    });
  }
  // The voice file changes the render hash, so the next render must include it.
  fs.rmSync(path.join(runDir(runId), "render.hash"), { force: true });
  return { voiceFile, video: output };
}

export interface FixRunResult {
  before: number;
  after: number;
  report: QAReport;
  videoAfter: string;
}

export async function runFix(
  runId: string,
  plan: VideoPlan,
  quality: Quality,
  options: { registry?: ReturnType<typeof buildRegistry> } = {},
): Promise<FixRunResult | null> {
  const qaFile = path.join(runDir(runId), "qa.json");
  if (!fs.existsSync(qaFile)) throw new Error(`No qa.json in ${runDir(runId)}. Run QA first.`);
  const before = readJson<{ score: number; issues: Array<Record<string, unknown>> }>(qaFile);
  fs.copyFileSync(qaFile, path.join(runDir(runId), "qa.before-fix.json"));
  fs.copyFileSync(path.join(runDir(runId), "plan.json"), path.join(runDir(runId), "plan.before-fix.json"));

  const fixed = applyDeterministicFixes(plan, before as never);
  if (fixed.patches.length === 0) {
    log.warn("No deterministic fixes available for the current QA report.");
    writeJson(path.join(runDir(runId), "fix.json"), {
      applied: false,
      scoreBefore: before.score,
      skipped: fixed.skipped,
    });
    return null;
  }

  writeRunPlan(runId, fixed.plan);
  writeJson(path.join(runDir(runId), "fix.json"), {
    applied: true,
    patches: fixed.patches,
    scoreBefore: before.score,
    skipped: fixed.skipped,
  });
  log.info(`Applied ${fixed.patches.length} patch(es); re-rendering.`);

  const output = renderRun(runId, fixed.plan, { quality, fixed: true });
  const after = await reviewVideo(runId, fixed.plan, output, options);
  const fixFile = path.join(runDir(runId), "fix.json");
  const current = readJson<Record<string, unknown>>(fixFile);
  writeJson(fixFile, {
    ...current,
    scoreAfter: after.score,
    verdictAfter: after.verdict,
    videoBefore: videoPath(runId),
    videoAfter: output,
  });
  log.info(`Fix loop: ${before.score} -> ${after.score}`);
  return { before: before.score, after: after.score, report: after, videoAfter: output };
}

export interface PlanFromBriefOptions {
  brief: string;
  ratio?: "16:9" | "9:16";
  runId: string;
  layout?: string;
}

export async function planFromBrief(
  options: PlanFromBriefOptions,
): Promise<{ plan: VideoPlan; runId: string; registry: ReturnType<typeof buildRegistry> }> {
  ensureRun(options.runId);
  const briefFile = path.join(runDir(options.runId), "brief.md");
  fs.writeFileSync(briefFile, options.brief, "utf8");
  const registry = buildRegistry(PROJECT_ROOT, runDir(options.runId));
  const created = await createVideoPlan(registry, {
    brief: options.brief,
    ratio: options.ratio,
    id: options.runId,
    ...(options.layout && options.layout !== "auto"
      ? { extraInstruction: `Use the "${options.layout}" scene layout for every scene.` }
      : {}),
  });
  const plan =
    options.layout && options.layout !== "auto"
      ? VideoPlanSchema.parse({
          ...created.plan,
          scenes: created.plan.scenes.map((scene) => ({
            ...scene,
            layout: options.layout as "device" | "data" | "type" | "hook",
          })),
        })
      : created.plan;
  writeRunPlan(options.runId, plan);
  writeJson(path.join(runDir(options.runId), "meta.json"), {
    runId: options.runId,
    createdAt: new Date().toISOString(),
    ratio: options.ratio ?? "16:9",
    layout: options.layout ?? "auto",
    modelRole: "director",
  });
  log.info(`Plan: ${path.join(runDir(options.runId), "plan.json")}`);
  return { plan, runId: options.runId, registry };
}

export interface MakeVideoOptions {
  brief: string;
  runId: string;
  ratio?: "16:9" | "9:16";
  quality: Quality;
  layout?: string;
  force?: boolean;
  registry?: ReturnType<typeof buildRegistry>;
}

export interface MakeVideoResult {
  runId: string;
  plan: VideoPlan;
  report: QAReport;
  video: string;
  fixed: boolean;
}

export async function makeVideo(options: MakeVideoOptions): Promise<MakeVideoResult> {
  const { plan, registry } = await planFromBrief({
    brief: options.brief,
    ratio: options.ratio,
    runId: options.runId,
    layout: options.layout,
  });
  const video = renderRun(options.runId, plan, {
    quality: options.quality,
    force: options.force,
  });
  let report = await reviewVideo(options.runId, plan, video, { registry });
  let finalVideo = video;
  let fixed = false;
  if (report.verdict !== "pass") {
    const result = await runFix(options.runId, plan, options.quality, { registry });
    if (result) {
      report = result.report;
      finalVideo = result.videoAfter;
      fixed = true;
    }
  }
  return { runId: options.runId, plan, report, video: finalVideo, fixed };
}

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { Command } from "commander";
import { loadEnvLocal } from "../core/env.js";
import { log } from "../core/log.js";
import {
  PROJECT_ROOT,
  RUNS_DIR,
  compositionDir,
  ensureDir,
  outDir,
  readJson,
  runDir,
  slugify,
  writeJson,
} from "../core/paths.js";
import { VideoPlanSchema, type VideoPlan } from "../plans/schema.js";
import { normalizePlan } from "../plans/validate.js";
import { writeComposition } from "../compose/html.js";
import { attachAudio, loadAudioConfig } from "../audio/mix.js";
import { renderWithHyperFrames } from "../render/hyperframes.js";
import { startPreviewServer } from "../render/preview-server.js";
import { reviewRun } from "../critique/index.js";
import { applyDeterministicFixes } from "../fix/fixer.js";
import { createVideoPlan } from "../director/plan.js";
import {
  buildRegistry,
  loadCapabilities,
  loadModelsConfig,
  missingModelEnv,
  resolveModels,
} from "../models/registry.js";
import { probeModels, writeCapabilities } from "../models/probe.js";

const VERSION = "0.1.0";

function ensureRun(runId: string): void {
  ensureDir(runDir(runId));
}

function readPlanFile(file: string): VideoPlan {
  const raw = readJson<unknown>(path.resolve(PROJECT_ROOT, file));
  const id =
    raw && typeof raw === "object" && "id" in raw && typeof (raw as { id?: unknown }).id === "string"
      ? (raw as { id: string }).id
      : path.basename(file, ".json");
  return normalizePlan(raw, { id: slugify(id) });
}

function readRunPlan(runId: string): VideoPlan {
  const file = path.join(runDir(runId), "plan.json");
  if (!fs.existsSync(file)) throw new Error(`No plan.json in ${runDir(runId)}. Run "auteur plan" or "auteur render --plan ..." first.`);
  return VideoPlanSchema.parse(readJson<unknown>(file));
}

function writeRunPlan(runId: string, plan: VideoPlan): void {
  ensureRun(runId);
  writeJson(path.join(runDir(runId), "plan.json"), plan);
}

function videoPath(runId: string, fixed = false): string {
  return path.join(outDir(runId), fixed ? "video.fixed.mp4" : "video.mp4");
}

function renderRun(
  runId: string,
  plan: VideoPlan,
  quality: "draft" | "looks" | "delivery",
  fixed = false,
): string {
  const artifacts = writeComposition(runId, plan);
  const output = videoPath(runId, fixed);
  const silent = output.replace(/\.mp4$/, ".silent.mp4");
  const result = renderWithHyperFrames({
    compositionDir: artifacts.dir,
    outFile: silent,
    fps: plan.fps,
    width: plan.width,
    height: plan.height,
    quality,
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
        suffix: fixed ? "fixed" : undefined,
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

  writeJson(path.join(runDir(runId), "render.json"), {
    ...result,
    outFile: output,
    silent,
    audio,
    composition: artifacts.dir,
    html: artifacts.htmlPath,
  });
  log.info(`Video: ${output}`);
  return output;
}

async function review(runId: string, plan: VideoPlan, video: string) {
  return reviewRun({ runId, plan, videoPath: video });
}

async function runFix(runId: string, plan: VideoPlan, quality: "draft" | "looks" | "delivery") {
  const qaFile = path.join(runDir(runId), "qa.json");
  if (!fs.existsSync(qaFile)) throw new Error(`No qa.json in ${runDir(runId)}. Run "auteur qa" first.`);
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

  const output = renderRun(runId, fixed.plan, quality, true);
  const after = await review(runId, fixed.plan, output);
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

function doctorCommand(program: Command) {
  return program
    .command("doctor")
    .description("Check the environment, relay configuration, and model capabilities.")
    .option("--strict", "exit non-zero when models are missing or unusable")
    .option("--no-probe", "skip live model probing")
    .action(async (options: { strict?: boolean; probe?: boolean }) => {
      loadEnvLocal(PROJECT_ROOT);
      log.step("Environment");
      const envRows: Array<Record<string, unknown>> = [
        { check: "Node", value: process.version },
        { check: "Platform", value: `${process.platform} ${process.arch}` },
      ];

      const ffmpeg = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
      envRows.push({
        check: "ffmpeg",
        value: ffmpeg.status === 0 ? (ffmpeg.stdout.split(/\r?\n/)[0] ?? "available") : "missing",
      });
      const ffprobe = spawnSync("ffprobe", ["-version"], { encoding: "utf8" });
      envRows.push({
        check: "ffprobe",
        value: ffprobe.status === 0 ? (ffprobe.stdout.split(/\r?\n/)[0] ?? "available") : "missing",
      });

      let hyperframesVersion = "missing";
      try {
        const pkg = JSON.parse(
          fs.readFileSync(path.join(PROJECT_ROOT, "node_modules", "hyperframes", "package.json"), "utf8"),
        ) as { version?: string };
        hyperframesVersion = pkg.version ?? "unknown";
      } catch {
        // keep missing
      }
      envRows.push({ check: "HyperFrames", value: hyperframesVersion });

      let playwrightPath = "missing";
      try {
        const executable = chromium.executablePath();
        playwrightPath = fs.existsSync(executable) ? executable : `missing (${executable})`;
      } catch (error) {
        playwrightPath = `missing (${error instanceof Error ? error.message : String(error)})`;
      }
      envRows.push({ check: "Playwright Chromium", value: playwrightPath });

      for (const font of ["inter-latin-400-normal.woff2", "inter-latin-600-normal.woff2"]) {
        const file = path.join(
          PROJECT_ROOT,
          "node_modules",
          "@fontsource",
          "inter",
          "files",
          font,
        );
        envRows.push({ check: font, value: fs.existsSync(file) ? "present" : "missing" });
      }
      log.table(envRows);

      log.step("Models");
      const config = loadModelsConfig(PROJECT_ROOT);
      const missing = missingModelEnv(config);
      if (missing.length > 0) {
        log.table(missing.map((entry) => ({ model: entry.model, missing: entry.missing.join(", ") })));
        log.warn("Fill .env.local before running a real plan. See .env.example.");
      }
      const capabilities = loadCapabilities(PROJECT_ROOT);
      const models = resolveModels(config, capabilities);
      log.table(
        models.map((model) => ({
          id: model.id,
          model: model.modelName,
          baseUrl: (() => {
            try {
              return new URL(model.baseUrl).host;
            } catch {
              return model.baseUrl;
            }
          })(),
          json: model.supports.json,
          images: model.supports.images,
        })),
      );

      if (models.length === 0) {
        log.warn("No usable models. Copy .env.example to .env.local and fill in the relay URL, key, and model names.");
      } else if (options.probe !== false) {
        log.step("Probing model capabilities");
        const probed = await probeModels(models);
        const file = writeCapabilities(probed, PROJECT_ROOT);
        log.info(`Capabilities: ${file}`);
      }

      if (options.strict && (models.length === 0 || missing.length > 0)) {
        process.exitCode = 1;
      }
    });
}

function planCommand(program: Command) {
  return program
    .command("plan")
    .description("Generate a VideoPlan from a brief using the configured director model.")
    .requiredOption("--brief <file>", "markdown brief")
    .option("--out <id>", "run id")
    .option("--ratio <ratio>", "16:9 or 9:16", "16:9")
    .action(async (options: { brief: string; out?: string; ratio: string }) => {
      loadEnvLocal(PROJECT_ROOT);
      const briefFile = path.resolve(PROJECT_ROOT, options.brief);
      const brief = fs.readFileSync(briefFile, "utf8");
      const ratio = options.ratio === "9:16" ? "9:16" : "16:9";
      const runId = slugify(options.out ?? path.basename(options.brief, path.extname(options.brief)));
      ensureRun(runId);
      const registry = buildRegistry(PROJECT_ROOT, runDir(runId));
      const { plan } = await createVideoPlan(registry, { brief, ratio, id: runId });
      writeRunPlan(runId, plan);
      fs.writeFileSync(path.join(runDir(runId), "brief.md"), brief, "utf8");
      writeJson(path.join(runDir(runId), "meta.json"), {
        runId,
        createdAt: new Date().toISOString(),
        ratio,
        modelRole: "director",
      });
      log.info(`Plan: ${path.join(runDir(runId), "plan.json")}`);
      log.info(`${plan.scenes.length} scenes · ${(plan.durationMs / 1000).toFixed(1)}s · ${plan.width}x${plan.height}`);
    });
}

function renderCommand(program: Command) {
  return program
    .command("render")
    .description("Build the composition HTML and render an MP4.")
    .option("--plan <file>", "plan JSON file")
    .option("--run <id>", "existing run id")
    .option("--quality <quality>", "draft, looks, or delivery", "looks")
    .option("--no-render", "only write the composition HTML")
    .action((options: { plan?: string; run?: string; quality: string; render?: boolean }) => {
      const quality = options.quality === "draft" || options.quality === "delivery" ? options.quality : "looks";
      let plan: VideoPlan;
      let runId: string;
      if (options.plan) {
        plan = readPlanFile(options.plan);
        runId = slugify(options.run ?? plan.id);
        writeRunPlan(runId, plan);
      } else {
        if (!options.run) throw new Error("Provide --plan <file> or --run <id>.");
        runId = slugify(options.run);
        plan = readRunPlan(runId);
      }

      if (options.render === false) {
        const artifacts = writeComposition(runId, plan);
        log.info(`Composition: ${artifacts.htmlPath}`);
        return;
      }

      renderRun(runId, plan, quality);
    });
}

function previewCommand(program: Command) {
  return program
    .command("preview")
    .description("Build the composition and start a local preview with a timeline scrubber.")
    .option("--plan <file>", "plan JSON file")
    .option("--run <id>", "existing run id")
    .option("--port <port>", "preferred port", "4321")
    .action(async (options: { plan?: string; run?: string; port: string }) => {
      let plan: VideoPlan;
      let runId: string;
      if (options.plan) {
        plan = readPlanFile(options.plan);
        runId = slugify(options.run ?? plan.id);
        writeRunPlan(runId, plan);
      } else {
        if (!options.run) throw new Error("Provide --plan <file> or --run <id>.");
        runId = slugify(options.run);
        plan = readRunPlan(runId);
      }
      const artifacts = writeComposition(runId, plan);
      const server = await startPreviewServer(artifacts.dir, Number(options.port));
      log.info(`Preview: ${server.url}`);
      log.info("Press Ctrl+C to stop.");
      await new Promise<void>((resolve) => {
        process.once("SIGINT", () => {
          void server.close().then(() => resolve());
        });
      });
    });
}

function qaCommand(program: Command) {
  return program
    .command("qa")
    .description("Audit a rendered video (DOM, media, HyperFrames).")
    .requiredOption("--run <id>", "run id")
    .option("--video <file>", "video path")
    .action(async (options: { run: string; video?: string }) => {
      const runId = slugify(options.run);
      const plan = readRunPlan(runId);
      writeComposition(runId, plan);
      const video = options.video ? path.resolve(PROJECT_ROOT, options.video) : videoPath(runId);
      const report = await review(runId, plan, video);
      log.table([
        { metric: "score", value: report.score },
        { metric: "verdict", value: report.verdict },
        { metric: "issues", value: report.issues.length },
      ]);
    });
}

function fixCommand(program: Command) {
  return program
    .command("fix")
    .description("Apply deterministic fixes from qa.json and re-render.")
    .requiredOption("--run <id>", "run id")
    .option("--quality <quality>", "draft, looks, or delivery", "looks")
    .action(async (options: { run: string; quality: string }) => {
      const runId = slugify(options.run);
      const plan = readRunPlan(runId);
      const quality = options.quality === "draft" || options.quality === "delivery" ? options.quality : "looks";
      const result = await runFix(runId, plan, quality);
      if (result) log.info(`Fixed video: ${result.videoAfter}`);
    });
}

function makeCommand(program: Command) {
  return program
    .command("make")
    .description("Plan, render, review, and (when possible) fix a video end-to-end.")
    .requiredOption("--brief <file>", "markdown brief")
    .option("--out <id>", "run id")
    .option("--ratio <ratio>", "16:9 or 9:16", "16:9")
    .option("--quality <quality>", "draft, looks, or delivery", "looks")
    .action(async (options: { brief: string; out?: string; ratio: string; quality: string }) => {
      loadEnvLocal(PROJECT_ROOT);
      const briefFile = path.resolve(PROJECT_ROOT, options.brief);
      const brief = fs.readFileSync(briefFile, "utf8");
      const ratio = options.ratio === "9:16" ? "9:16" : "16:9";
      const runId = slugify(options.out ?? path.basename(options.brief, path.extname(options.brief)));
      const quality = options.quality === "draft" || options.quality === "delivery" ? options.quality : "looks";
      ensureRun(runId);
      fs.writeFileSync(path.join(runDir(runId), "brief.md"), brief, "utf8");
      const registry = buildRegistry(PROJECT_ROOT, runDir(runId));
      log.step("Directing");
      const { plan } = await createVideoPlan(registry, { brief, ratio, id: runId });
      writeRunPlan(runId, plan);
      log.info(`${plan.scenes.length} scenes · ${(plan.durationMs / 1000).toFixed(1)}s`);

      log.step("Rendering");
      const video = renderRun(runId, plan, quality);

      log.step("Reviewing");
      let report = await review(runId, plan, video);
      let finalVideo = video;
      if (report.verdict !== "pass") {
        log.step("Fixing");
        const fixed = await runFix(runId, plan, quality);
        if (fixed) {
          report = fixed.report;
          finalVideo = fixed.videoAfter;
        }
      }
      log.info(`Done. Score ${report.score}/100 · ${report.verdict}`);
      log.info(`Video: ${finalVideo}`);
    });
}

async function main(): Promise<void> {
  loadEnvLocal(PROJECT_ROOT);
  const program = new Command();
  program.name("auteur").description("Model-agnostic product/UI motion graphics studio.").version(VERSION);
  doctorCommand(program);
  planCommand(program);
  renderCommand(program);
  previewCommand(program);
  qaCommand(program);
  fixCommand(program);
  makeCommand(program);
  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  log.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

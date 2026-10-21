import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { Command } from "commander";
import { loadEnvLocal } from "../core/env.js";
import { log } from "../core/log.js";
import {
  PROJECT_ROOT,
  compositionDir,
  ensureDir,
  readJson,
  runDir,
  slugify,
  writeJson,
} from "../core/paths.js";
import type { VideoPlan } from "../plans/schema.js";
import { writeComposition } from "../compose/html.js";
import { startPreviewServer } from "../render/preview-server.js";
import {
  ensureRun,
  makeVideo,
  planFromBrief,
  readPlanFile,
  readRunPlan,
  renderRun,
  reviewVideo,
  runFix,
  validateQuality,
  videoPath,
  writeRunPlan,
} from "../pipeline/run.js";
import {
  buildRegistry,
  loadCapabilities,
  loadModelsConfig,
  missingModelEnv,
  resolveModels,
} from "../models/registry.js";
import { probeModels, writeCapabilities } from "../models/probe.js";

const VERSION = "0.2.0";

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
        const file = path.join(PROJECT_ROOT, "node_modules", "@fontsource", "inter", "files", font);
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

      if (options.strict && (models.length === 0 || missing.length > 0)) process.exitCode = 1;
    });
}

function planCommand(program: Command) {
  return program
    .command("plan")
    .description("Generate a VideoPlan from a brief using the configured director model.")
    .requiredOption("--brief <file>", "markdown brief")
    .option("--out <id>", "run id")
    .option("--ratio <ratio>", "16:9 or 9:16", "16:9")
    .option("--layout <layout>", "device, data, type, hook, or auto", "auto")
    .action(async (options: { brief: string; out?: string; ratio: string; layout: string }) => {
      loadEnvLocal(PROJECT_ROOT);
      const brief = fs.readFileSync(path.resolve(PROJECT_ROOT, options.brief), "utf8");
      const ratio = options.ratio === "9:16" ? "9:16" : "16:9";
      const runId = slugify(options.out ?? path.basename(options.brief, path.extname(options.brief)));
      const { plan } = await planFromBrief({ brief, ratio, runId, layout: options.layout });
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
    .option("--force", "ignore the render cache")
    .option("--no-render", "only write the composition HTML")
    .action((options: { plan?: string; run?: string; quality: string; force?: boolean; render?: boolean }) => {
      const quality = validateQuality(options.quality);
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
      renderRun(runId, plan, { quality, force: options.force });
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
    .description("Audit a rendered video (DOM, media, HyperFrames, audio).")
    .requiredOption("--run <id>", "run id")
    .option("--video <file>", "video path")
    .option("--no-vlm", "skip the advisory VLM contact-sheet review")
    .action(async (options: { run: string; video?: string; vlm?: boolean }) => {
      const runId = slugify(options.run);
      const plan = readRunPlan(runId);
      writeComposition(runId, plan);
      const video = options.video ? path.resolve(PROJECT_ROOT, options.video) : videoPath(runId);
      let registry: ReturnType<typeof buildRegistry> | undefined;
      if (options.vlm !== false) {
        try {
          registry = buildRegistry(PROJECT_ROOT, runDir(runId));
        } catch (error) {
          log.warn(`VLM review skipped: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const report = await reviewVideo(runId, plan, video, registry ? { registry } : {});
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
      const result = await runFix(runId, readRunPlan(runId), validateQuality(options.quality));
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
    .option("--layout <layout>", "device, data, type, hook, or auto", "auto")
    .option("--quality <quality>", "draft, looks, or delivery", "looks")
    .option("--force", "ignore the render cache")
    .action(async (options: {
      brief: string;
      out?: string;
      ratio: string;
      layout: string;
      quality: string;
      force?: boolean;
    }) => {
      loadEnvLocal(PROJECT_ROOT);
      const brief = fs.readFileSync(path.resolve(PROJECT_ROOT, options.brief), "utf8");
      const runId = slugify(options.out ?? path.basename(options.brief, path.extname(options.brief)));
      ensureRun(runId);
      const result = await makeVideo({
        brief,
        runId,
        ratio: options.ratio === "9:16" ? "9:16" : "16:9",
        quality: validateQuality(options.quality),
        layout: options.layout,
        force: options.force,
      });
      log.info(`Done. Score ${result.report.score}/100 · ${result.report.verdict}`);
      log.info(`Video: ${result.video}`);
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

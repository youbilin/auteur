import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { ensureDir, PROJECT_ROOT } from "../core/paths.js";
import { extractJson } from "../models/client.js";
import { log } from "../core/log.js";

const require = createRequire(import.meta.url);

function hyperframesBin(): string {
  const pkgPath = require.resolve("hyperframes/package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
    bin?: string | Record<string, string>;
  };
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.hyperframes;
  if (!bin) throw new Error("Could not find the hyperframes CLI entry in node_modules");
  return path.resolve(path.dirname(pkgPath), bin);
}

export interface RenderOptions {
  compositionDir: string;
  outFile: string;
  fps: number;
  width: number;
  height: number;
  quality?: "draft" | "looks" | "delivery";
}

export interface RenderResult {
  outFile: string;
  tool: "hyperframes";
  stdoutTail: string;
}

export function resolutionPreset(width: number, height: number): "landscape" | "portrait" {
  return width >= height ? "landscape" : "portrait";
}

export function renderWithHyperFrames(options: RenderOptions): RenderResult {
  const bin = hyperframesBin();
  ensureDir(path.dirname(options.outFile));

  const args = [
    bin,
    "render",
    options.compositionDir,
    "-o",
    options.outFile,
    "--fps",
    String(options.fps),
    "--quality",
    options.quality ?? "looks",
    "--resolution",
    resolutionPreset(options.width, options.height),
    "--quiet",
  ];

  log.info(`Rendering with HyperFrames (${options.width}x${options.height}, ${options.fps}fps)`);
  const result = spawnSync(process.execPath, args, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: {
      ...process.env,
      HYPERFRAMES_SKIP_SKILLS: "1",
    },
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim().slice(-4000);
    throw new Error(`HyperFrames render failed (exit ${result.status}).\n${detail}`);
  }
  if (!fs.existsSync(options.outFile)) {
    throw new Error(`HyperFrames reported success but ${options.outFile} does not exist`);
  }

  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  return {
    outFile: options.outFile,
    tool: "hyperframes",
    stdoutTail: combined.split(/\r?\n/).slice(-8).join("\n"),
  };
}

export interface HyperFramesCheckResult {
  ok: boolean;
  strict?: boolean;
  lint?: unknown;
  runtime?: unknown;
  layout?: unknown;
  motion?: unknown;
  contrast?: unknown;
  raw?: unknown;
  stdoutTail: string;
}

export function checkWithHyperFrames(compositionDir: string): HyperFramesCheckResult {
  const bin = hyperframesBin();
  const result = spawnSync(
    process.execPath,
    [bin, "check", compositionDir, "--json", "--samples", "5", "--at-transitions"],
    {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      env: {
        ...process.env,
        HYPERFRAMES_SKIP_SKILLS: "1",
      },
    },
  );

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  if (result.error) {
    return { ok: false, stdoutTail: output.slice(-2000), raw: result.error.message };
  }

  let parsed: unknown;
  try {
    parsed = extractJson(result.stdout || output);
  } catch (error) {
    return {
      ok: false,
      stdoutTail: output.slice(-2000),
      raw: error instanceof Error ? error.message : String(error),
    };
  }

  const data = parsed as HyperFramesCheckResult;
  return {
    ...data,
    raw: parsed,
    stdoutTail: output.split(/\r?\n/).slice(-8).join("\n"),
  };
}

import fs from "node:fs";
import path from "node:path";

export const PROJECT_ROOT = process.cwd();
export const CONFIG_DIR = path.join(PROJECT_ROOT, "config");
export const ASSETS_DIR = path.join(PROJECT_ROOT, "assets");
export const RUNS_DIR = path.join(PROJECT_ROOT, "runs");
export const EXAMPLES_DIR = path.join(PROJECT_ROOT, "examples");

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function runDir(runId: string): string {
  return path.join(RUNS_DIR, runId);
}

export function compositionDir(runId: string): string {
  return path.join(runDir(runId), "composition");
}

export function outDir(runId: string): string {
  return path.join(runDir(runId), "out");
}

export function resolveRunPath(input: string): string {
  if (path.isAbsolute(input)) return input;
  const fromCwd = path.resolve(PROJECT_ROOT, input);
  if (fs.existsSync(fromCwd)) return fromCwd;
  return path.resolve(RUNS_DIR, input);
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "run";
}

export function timestampId(prefix = "run"): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${prefix}-${stamp}`;
}

export function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

export function writeJson(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

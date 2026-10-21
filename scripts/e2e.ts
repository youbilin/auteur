import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readJson } from "../src/core/paths.js";

function cli(args: string[]): void {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/cli/index.ts", ...args],
    { stdio: "inherit", encoding: "utf8" },
  );
  assert.equal(result.status, 0, `CLI failed: ${args.join(" ")}`);
}

const runId = "arc-release";
const video = path.join("runs", runId, "out", "video.mp4");

cli(["render", "--plan", "examples/plan-arc.json", "--quality", "draft"]);
assert.ok(fs.existsSync(video), "video was not created");
assert.ok(fs.statSync(video).size > 10_000, "video is suspiciously small");

cli(["qa", "--run", runId]);

const qa = readJson<{ score: number; verdict: string; issues: unknown[] }>(
  path.join("runs", runId, "qa.json"),
);
assert.ok(qa.score >= 85, `QA score too low: ${qa.score}`);
assert.notEqual(qa.verdict, "fail", `QA verdict: ${qa.verdict}`);
assert.ok(fs.existsSync(path.join("runs", runId, "qa.md")), "qa.md missing");

console.log(`e2e passed: score=${qa.score} verdict=${qa.verdict} issues=${qa.issues.length}`);

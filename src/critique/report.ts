import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ensureDir, runDir, writeJson } from "../core/paths.js";
import type { QAIssue, QAReport, VideoPlan } from "../plans/schema.js";
import type { MediaFacts } from "./media.js";

function deduction(issues: QAIssue[]): number {
  return issues.reduce((total, issue) => {
    if (issue.severity === "blocker") return total + 15;
    if (issue.severity === "major") return total + 5;
    return total + 1;
  }, 0);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export interface BuildReportInput {
  runId: string;
  plan: VideoPlan;
  videoPath: string;
  issues: QAIssue[];
  facts: MediaFacts;
  notes?: string[];
  contactSheet?: string;
}

export function buildQaReport(input: BuildReportInput): QAReport {
  const domIssues = input.issues.filter((issue) => issue.critic === "dom");
  const mediaIssues = input.issues.filter((issue) => issue.critic === "media");
  const hfIssues = input.issues.filter((issue) => issue.critic === "hyperframes");
  const score = clampScore(100 - deduction(input.issues));
  const hasBlocker = input.issues.some((issue) => issue.severity === "blocker");
  const hasMajor = input.issues.some((issue) => issue.severity === "major");
  const verdict: QAReport["verdict"] = hasBlocker || score < 55
    ? "fail"
    : hasMajor || score < 85
      ? "fix"
      : "pass";

  return {
    runId: input.runId,
    createdAt: new Date().toISOString(),
    score,
    verdict,
    rubric: {
      dom: clampScore(100 - deduction(domIssues)),
      media: clampScore(100 - deduction(mediaIssues)),
      hyperframes: clampScore(100 - deduction(hfIssues)),
    },
    issues: input.issues,
    artifacts: {
      video: input.videoPath,
      frames: [],
      contactSheet: input.contactSheet,
    },
    notes: input.notes ?? [],
  };
}

export function createContactSheet(videoPath: string, runId: string, durationSec: number): string | undefined {
  const dir = ensureDir(path.join(runDir(runId), "frames"));
  const out = path.join(dir, "contact-sheet.jpg");
  const interval = Math.max(1, durationSec / 4);
  const result = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-i",
      videoPath,
      "-vf",
      `fps=1/${interval.toFixed(3)},scale=480:-1,tile=2x2:padding=8:margin=8`,
      "-frames:v",
      "1",
      out,
    ],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  if (result.status !== 0 || !fs.existsSync(out)) return undefined;
  return out;
}

export function writeQaFiles(runId: string, report: QAReport, plan: VideoPlan, facts: MediaFacts): void {
  const dir = ensureDir(runDir(runId));
  writeJson(path.join(dir, "qa.json"), report);

  const lines: string[] = [];
  lines.push(`# QA report — ${runId}`);
  lines.push("");
  lines.push(`Score: **${report.score}/100** · Verdict: **${report.verdict}**`);
  lines.push("");
  lines.push(`Video: \`${report.artifacts.video}\``);
  lines.push("");
  lines.push("## Facts");
  lines.push("");
  lines.push(`- Resolution: ${facts.width ?? "?"}x${facts.height ?? "?"} (expected ${plan.width}x${plan.height})`);
  lines.push(`- FPS: ${facts.fps ?? "?"} (expected ${plan.fps})`);
  lines.push(`- Duration: ${facts.duration?.toFixed(2) ?? "?"}s (expected ${(plan.durationMs / 1000).toFixed(2)}s)`);
  lines.push(`- Frames: ${facts.frames ?? "?"}`);
  lines.push(
    `- Audio: ${
      facts.hasAudio
        ? `yes · ${facts.audioLufs?.toFixed(1) ?? "?"} LUFS · peak ${facts.audioPeak?.toFixed(1) ?? "?"} dBFS`
        : "no"
    }`,
  );
  lines.push("");
  lines.push("## Rubric");
  lines.push("");
  lines.push(`- DOM: ${report.rubric.dom}`);
  lines.push(`- Media: ${report.rubric.media}`);
  lines.push(`- HyperFrames: ${report.rubric.hyperframes ?? "n/a"}`);
  lines.push("");

  if (report.issues.length === 0) {
    lines.push("No issues found.");
  } else {
    lines.push("## Issues");
    lines.push("");
    lines.push("| severity | critic | at | code | message |");
    lines.push("|---|---|---|---|---|");
    for (const issue of report.issues) {
      lines.push(
        `| ${issue.severity} | ${issue.critic} | ${(issue.atMs / 1000).toFixed(2)}s | ${issue.code} | ${issue.message.replace(/\|/g, "\\|")} |`,
      );
    }
  }

  if (report.notes.length > 0) {
    lines.push("");
    lines.push("## Notes");
    lines.push("");
    for (const note of report.notes) lines.push(`- ${note}`);
  }

  if (report.artifacts.contactSheet) {
    lines.push("");
    lines.push(`Contact sheet: \`${report.artifacts.contactSheet}\``);
  }

  fs.writeFileSync(path.join(dir, "qa.md"), `${lines.join("\n")}\n`, "utf8");
}

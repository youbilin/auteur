import path from "node:path";
import { writeJson, compositionDir, runDir } from "../core/paths.js";
import type { QAReport, VideoPlan } from "../plans/schema.js";
import { auditDom } from "./dom.js";
import { auditMedia } from "./media.js";
import { hyperframesIssues } from "./hyperframes.js";
import { buildQaReport, createContactSheet, writeQaFiles } from "./report.js";
import { checkWithHyperFrames } from "../render/hyperframes.js";
import { log } from "../core/log.js";

export interface ReviewOptions {
  runId: string;
  plan: VideoPlan;
  videoPath: string;
}

export async function reviewRun(options: ReviewOptions): Promise<QAReport> {
  const composition = compositionDir(options.runId);
  const htmlPath = path.join(composition, "index.html");

  log.step("Auditing rendered composition (DOM)");
  const domIssues = await auditDom(htmlPath, options.plan);

  log.step("Auditing media");
  const media = auditMedia(options.videoPath, options.plan);

  log.step("Running HyperFrames check");
  const hf = checkWithHyperFrames(composition);
  const hfMapped = hyperframesIssues(hf, options.plan);
  writeJson(path.join(runDir(options.runId), "hyperframes-check.json"), hf);

  const contactSheet = createContactSheet(
    options.videoPath,
    options.runId,
    options.plan.durationMs / 1000,
  );

  const notes = [...hfMapped.notes];
  if (!media.facts.hasAudio) notes.push("No audio track: audio review skipped.");
  if (!contactSheet) notes.push("Contact sheet could not be generated.");

  const report = buildQaReport({
    runId: options.runId,
    plan: options.plan,
    videoPath: options.videoPath,
    issues: [...domIssues, ...media.issues, ...hfMapped.issues],
    facts: media.facts,
    notes,
    contactSheet,
  });

  writeQaFiles(options.runId, report, options.plan, media.facts);
  log.info(
    `QA score ${report.score}/100 · ${report.verdict} · ${report.issues.length} issue(s) · ${path.join(runDir(options.runId), "qa.md")}`,
  );
  return report;
}

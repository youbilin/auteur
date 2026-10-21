import type { QAIssue, VideoPlan } from "../plans/schema.js";
import type { HyperFramesCheckResult } from "../render/hyperframes.js";

interface HfFinding {
  code?: string;
  severity?: string;
  message?: string;
  selector?: string;
  time?: number;
}

interface HfSection {
  ok?: boolean;
  findings?: HfFinding[];
}

function sceneIdAt(plan: VideoPlan, atMs: number): string | undefined {
  return plan.scenes.find((scene) => atMs >= scene.startMs && atMs < scene.startMs + scene.durationMs)?.id;
}

function severityFor(section: string, finding: HfFinding): "blocker" | "major" | "minor" {
  if (finding.severity === "error") return "blocker";
  if (finding.severity === "warning") {
    if (section === "motion" && finding.code === "sweep_static") return "minor";
    if (section === "contrast" || section === "layout" || section === "runtime") return "major";
    return "minor";
  }
  return "minor";
}

export function hyperframesIssues(
  result: HyperFramesCheckResult,
  plan: VideoPlan,
): { issues: QAIssue[]; notes: string[] } {
  const issues: QAIssue[] = [];
  const notes: string[] = [];

  if (!result.raw || typeof result.raw === "string") {
    notes.push(`HyperFrames check did not return parsed JSON: ${result.raw}`);
  }

  const sections: Array<[string, HfSection | undefined]> = [
    ["lint", result.lint as HfSection | undefined],
    ["runtime", result.runtime as HfSection | undefined],
    ["layout", result.layout as HfSection | undefined],
    ["motion", result.motion as HfSection | undefined],
    ["contrast", result.contrast as HfSection | undefined],
  ];

  for (const [sectionName, section] of sections) {
    if (!section?.findings?.length) continue;
    for (const finding of section.findings) {
      if (
        finding.code === "composition_file_too_large" ||
        finding.code === "nested_structure_needs_subcomposition" ||
        finding.code === "timeline_track_too_dense"
      ) {
        notes.push(`${sectionName}: ${finding.message ?? finding.code}`);
        continue;
      }
      const atMs = Math.round((finding.time ?? 0) * 1000);
      issues.push({
        id: `hf-${sectionName}-${issues.length + 1}`,
        critic: "hyperframes",
        severity: severityFor(sectionName, finding),
        atMs,
        sceneId: sceneIdAt(plan, atMs),
        code: `hf_${sectionName}_${finding.code ?? "unknown"}`,
        message: `${sectionName}: ${finding.message ?? finding.code ?? "unknown issue"}`,
        evidence: {
          selector: finding.selector,
        },
      });
    }
  }

  if (!result.ok) {
    notes.push(`HyperFrames check reported a failure. ${result.stdoutTail.slice(-500)}`);
  }

  return { issues, notes };
}

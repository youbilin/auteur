import jsonPatch from "fast-json-patch";
import type { Operation } from "fast-json-patch";
import { VideoPlanSchema, type QAIssue, type VideoPlan } from "../plans/schema.js";

const { applyPatch } = jsonPatch;

function toPointer(path: string): string {
  if (path.startsWith("/")) return path;
  return `/${path
    .split(".")
    .map((segment) => segment.replace(/~/g, "~0").replace(/\//g, "~1"))
    .join("/")}`;
}

export interface FixResult {
  plan: VideoPlan;
  patches: Operation[];
  skipped: Array<{ issue: string; reason: string }>;
}

export function applyDeterministicFixes(plan: VideoPlan, report: { issues: QAIssue[] }): FixResult {
  const patches: Operation[] = [];
  const skipped: Array<{ issue: string; reason: string }> = [];
  const seen = new Set<string>();

  for (const issue of report.issues) {
    if (issue.severity !== "blocker" && issue.severity !== "major") continue;
    if (!issue.fix) continue;
    const patch = {
      op: issue.fix.op,
      path: toPointer(issue.fix.path),
      ...(issue.fix.value === undefined ? {} : { value: issue.fix.value }),
    } as Operation;
    const key = `${patch.op}:${patch.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    patches.push(patch);
  }

  if (patches.length === 0) {
    return { plan, patches, skipped };
  }

  try {
    const result = applyPatch(plan, patches, true, false);
    const checked = VideoPlanSchema.safeParse(result.newDocument);
    if (!checked.success) {
      return {
        plan,
        patches: [],
        skipped: checked.error.issues.map((issue) => ({
          issue: issue.path.join(".") || "(root)",
          reason: issue.message,
        })),
      };
    }
    return { plan: checked.data, patches, skipped };
  } catch (error) {
    return {
      plan,
      patches: [],
      skipped: [
        ...skipped,
        {
          issue: "patch",
          reason: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

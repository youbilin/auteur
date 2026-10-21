import { describe, expect, it } from "vitest";
import { readJson } from "../src/core/paths.js";
import { normalizePlan } from "../src/plans/validate.js";
import { applyDeterministicFixes } from "../src/fix/fixer.js";
import type { QAIssue } from "../src/plans/schema.js";

const plan = normalizePlan(readJson<unknown>("examples/plan-arc.json"), { id: "arc-release" });

function issue(fix: QAIssue["fix"]): QAIssue {
  return {
    id: "test",
    critic: "dom",
    severity: "major",
    atMs: 0,
    code: "dom_overflow",
    message: "test issue",
    ...(fix ? { fix } : {}),
  };
}

describe("deterministic fixer", () => {
  it("applies a fit patch and keeps the plan valid", () => {
    const result = applyDeterministicFixes(plan, {
      issues: [issue({ op: "add", path: "scenes.0.fit", value: { headlineScale: 0.92 } })],
    });
    expect(result.patches).toHaveLength(1);
    expect(result.plan.scenes[0]?.fit?.headlineScale).toBe(0.92);
  });

  it("skips patches that break the schema", () => {
    const result = applyDeterministicFixes(plan, {
      issues: [issue({ op: "replace", path: "scenes.0.copy.headline", value: "x".repeat(100) })],
    });
    expect(result.patches).toHaveLength(0);
    expect(result.plan).toEqual(plan);
  });

  it("ignores issues without a fix", () => {
    const result = applyDeterministicFixes(plan, { issues: [issue(undefined)] });
    expect(result.patches).toHaveLength(0);
  });
});

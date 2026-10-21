import { describe, expect, it } from "vitest";
import { readJson } from "../src/core/paths.js";
import { normalizePlan } from "../src/plans/validate.js";
import { buildCompositionHtml } from "../src/compose/html.js";

describe("layout variants and CJK", () => {
  it("keeps all four scene layouts", () => {
    const plan = normalizePlan(readJson<unknown>("examples/plan-layouts.json"));
    expect(plan.scenes.map((scene) => scene.layout)).toEqual([
      "device",
      "data",
      "type",
      "hook",
    ]);
    const html = buildCompositionHtml(plan);
    expect(html).toContain("layout-device");
    expect(html).toContain("layout-data");
    expect(html).toContain("layout-type");
    expect(html).toContain("layout-hook");
  });

  it("marks Chinese plans and keeps the local CJK font face", () => {
    const plan = normalizePlan(readJson<unknown>("examples/plan-zh.json"));
    const html = buildCompositionHtml(plan);
    expect(html).toContain('<html lang="zh-CN">');
    expect(html).toContain("lang-zh");
    expect(html).toContain('font-family:"Auteur CJK"');
  });

  it("renders a hook value from the first stat-bearing block", () => {
    const plan = normalizePlan(readJson<unknown>("examples/plan-layouts.json"));
    const html = buildCompositionHtml(plan);
    expect(html).toContain("+40 XP");
    expect(html).toContain("Paid for starting");
  });
});

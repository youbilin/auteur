import { describe, expect, it } from "vitest";
import { readJson } from "../src/core/paths.js";
import { normalizePlan } from "../src/plans/validate.js";
import { VideoPlanSchema } from "../src/plans/schema.js";

const example = readJson<unknown>("examples/plan-arc.json");

describe("VideoPlan normalization", () => {
  it("fills derived timing and dimensions from the example", () => {
    const plan = normalizePlan(example, { id: "arc-release" });
    expect(plan.width).toBe(1920);
    expect(plan.height).toBe(1080);
    expect(plan.fps).toBe(30);
    expect(plan.durationMs).toBe(12000);
    expect(plan.scenes.map((scene) => scene.startMs)).toEqual([0, 4000, 8000]);
    expect(VideoPlanSchema.safeParse(plan).success).toBe(true);
  });

  it("rejects a plan with fewer than two scenes", () => {
    const input = structuredClone(example) as { scenes: unknown[] };
    input.scenes = input.scenes.slice(0, 1);
    expect(() => normalizePlan(input)).toThrow();
  });

  it("rejects a scene shorter than the minimum duration", () => {
    const input = structuredClone(example) as { scenes: Array<{ durationMs: number }> };
    input.scenes[0]!.durationMs = 2000;
    expect(() => normalizePlan(input)).toThrow();
  });

  it("drops a tagline that repeats a scene headline", () => {
    const input = structuredClone(example) as {
      brand: { tagline?: string };
      scenes: Array<{ copy: { headline: string } }>;
    };
    input.brand.tagline = input.scenes[0]!.copy.headline;
    const plan = normalizePlan(input);
    expect(plan.brand.tagline).toBeUndefined();
  });

  it("does not repeat the app name in the first header block", () => {
    const input = structuredClone(example) as {
      scenes: Array<{
        screen: {
          appName: string;
          blocks: Array<{ kind: string; text?: string; sub?: string }>;
        };
      }>;
    };
    input.scenes[0]!.screen.blocks[0] = {
      kind: "header",
      text: input.scenes[0]!.screen.appName,
      sub: "still here",
    };
    const plan = normalizePlan(input);
    const first = plan.scenes[0]?.screen.blocks[0];
    expect(first?.kind).toBe("header");
    if (first?.kind === "header") {
      expect(first.text.toLowerCase()).not.toBe(plan.scenes[0]?.screen.appName.toLowerCase());
      expect(first.text).toBe("Releases");
    }
  });
});

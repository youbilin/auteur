import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { readJson } from "../src/core/paths.js";
import { normalizePlan } from "../src/plans/validate.js";
import { buildCompositionHtml } from "../src/compose/html.js";

const plan = normalizePlan(readJson<unknown>("examples/plan-arc.json"), { id: "arc-release" });

describe("composition determinism", () => {
  it("produces the same HTML hash twice", () => {
    const first = buildCompositionHtml(plan);
    const second = buildCompositionHtml(plan);
    const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
    expect(hash(first)).toBe(hash(second));
  });

  it("uses the local GSAP file instead of a CDN", () => {
    const html = buildCompositionHtml(plan);
    expect(html).toContain('<script src="./gsap.min.js"></script>');
    expect(html).not.toContain("cdn.jsdelivr.net");
  });

  it("does not contain wall-clock or random calls in the composition script", () => {
    const html = buildCompositionHtml(plan);
    const ownScript = html.split('<script src="./gsap.min.js"></script>')[1] ?? "";
    expect(ownScript).not.toContain("Math.random");
    expect(ownScript).not.toContain("Date.now");
  });
});

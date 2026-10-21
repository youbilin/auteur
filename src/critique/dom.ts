import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type ConsoleMessage } from "playwright";
import type { QAIssue, VideoPlan } from "../plans/schema.js";
import { log } from "../core/log.js";

interface RawDomFinding {
  kind: "overflow" | "overlap" | "safe" | "font";
  path: string;
  sceneIndex: number;
  role: string;
  text: string;
  detail: string;
  metric: number;
  atMs?: number;
}

// Kept as a string on purpose: tsx/esbuild injects a __name helper into
// serialized functions, which does not exist inside the browser page.
const DOM_AUDIT_SCRIPT = `(() => {
  const findings = [];
  const elements = Array.from(document.querySelectorAll("[data-plan-path]"));
  const rect = (el) => el.getBoundingClientRect();

  for (const el of elements) {
    const style = getComputedStyle(el);
    if (style.display === "none" || Number(style.opacity) < 0.05) continue;
    const sceneInner = el.closest(".scene-inner");
    if (sceneInner && Number(getComputedStyle(sceneInner).opacity) < 0.05) continue;
    const r = rect(el);
    if (r.width < 1 || r.height < 1) continue;
    const scene = el.closest(".scene");
    const sceneIndex = Number(scene && scene.dataset ? scene.dataset.planScene : -1);
    const role = el.dataset.auteurRole || "text";
    const planPath = el.dataset.planPath || "";
    if (!planPath || sceneIndex < 0) continue;
    const text = (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 100);
    const fontSize = parseFloat(style.fontSize);
    const overflowX = el.scrollWidth - el.clientWidth;
    const overflowY = el.scrollHeight - el.clientHeight;
    const truncated = style.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1;
    const verticalClipped = (style.overflowY === "hidden" || style.overflowY === "clip") && overflowY > 4;

    if (overflowX > 5 || truncated || verticalClipped) {
      findings.push({
        kind: "overflow",
        path: planPath,
        sceneIndex,
        role,
        text,
        detail: "Text overflows (" + Math.max(overflowX, verticalClipped ? overflowY : 0) + "px)",
        metric: Math.max(overflowX, verticalClipped ? overflowY : 0),
      });
    }

    const isCopy = planPath.indexOf(".copy.") !== -1;
    const isCallout = planPath.indexOf(".callouts.") !== -1;
    const minSize = isCopy ? 13 : isCallout ? 12 : 9;
    if (fontSize > 0 && fontSize < minSize) {
      findings.push({
        kind: "font",
        path: planPath,
        sceneIndex,
        role,
        text,
        detail: "Font size " + fontSize.toFixed(1) + "px is below " + minSize + "px",
        metric: fontSize,
      });
    }

    if (isCopy || isCallout) {
      const padX = window.innerWidth * 0.03;
      const padY = window.innerHeight * 0.03;
      if (r.left < padX || r.top < padY || r.right > window.innerWidth - padX || r.bottom > window.innerHeight - padY) {
        findings.push({
          kind: "safe",
          path: planPath,
          sceneIndex,
          role,
          text,
          detail: "Element enters the outer 3% safe margin",
          metric: Math.min(r.left, r.top, window.innerWidth - r.right, window.innerHeight - r.bottom),
        });
      }
    }
  }

  const callouts = Array.from(document.querySelectorAll(".callout"));
  const copyEls = Array.from(document.querySelectorAll(".copy .anim"));
  const intersectArea = (a, b) => {
    const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return width > 4 && height > 4 ? width * height : 0;
  };

  for (const callout of callouts) {
    const calloutStyle = getComputedStyle(callout);
    if (calloutStyle.display === "none" || Number(calloutStyle.opacity) < 0.05) continue;
    const calloutSceneInner = callout.closest(".scene-inner");
    if (calloutSceneInner && Number(getComputedStyle(calloutSceneInner).opacity) < 0.05) continue;
    const calloutRect = rect(callout);
    const pathEl = callout.querySelector("[data-plan-path]");
    const calloutPath = pathEl ? pathEl.dataset.planPath || "" : "";
    const scene = callout.closest(".scene");
    const sceneIndex = Number(scene && scene.dataset ? scene.dataset.planScene : -1);
    if (!calloutPath || sceneIndex < 0) continue;
    const text = (callout.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 100);

    for (const other of copyEls) {
      const otherStyle = getComputedStyle(other);
      if (otherStyle.display === "none" || Number(otherStyle.opacity) < 0.05) continue;
      const area = intersectArea(calloutRect, rect(other));
      if (area > 0) {
        findings.push({
          kind: "overlap",
          path: calloutPath,
          sceneIndex,
          role: "callout",
          text,
          detail: "Callout overlaps the copy column",
          metric: Math.round(area),
        });
        break;
      }
    }
  }

  return findings;
})()`;

function sampleTimes(plan: VideoPlan): number[] {
  const times = new Set<number>();
  for (const scene of plan.scenes) {
    times.add(scene.startMs + 120);
    times.add(scene.startMs + Math.round(scene.durationMs / 2));
    times.add(scene.startMs + scene.durationMs - 120);
    for (const callout of scene.callouts) {
      times.add(scene.startMs + callout.enterMs + 120);
      times.add(scene.startMs + callout.exitMs - 80);
    }
  }
  return [...times]
    .filter((time) => time >= 0 && time <= plan.durationMs)
    .sort((a, b) => a - b);
}

function truncateWords(value: string, max: number): string {
  if (value.length <= max) return value;
  const slice = value.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(" ");
  const base = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${base.trimEnd()}…`;
}

function fitFix(
  plan: VideoPlan,
  sceneIndex: number,
  key: "headlineScale" | "subScale",
  step: number,
) {
  const scene = plan.scenes[sceneIndex];
  if (!scene) return undefined;
  const current = scene.fit ?? {};
  const nextScale = Math.max(0.68, Number(((current[key] ?? 1) - step).toFixed(3)));
  return {
    op: scene.fit ? ("replace" as const) : ("add" as const),
    path: `scenes.${sceneIndex}.fit`,
    value: { ...current, [key]: nextScale },
  };
}

function fixForFinding(plan: VideoPlan, finding: RawDomFinding) {
  if (finding.kind !== "overflow") return undefined;
  const step = finding.metric > 24 ? 0.12 : 0.06;
  if (finding.path.endsWith(".copy.headline")) {
    return fitFix(plan, finding.sceneIndex, "headlineScale", step);
  }
  if (finding.path.endsWith(".copy.sub")) {
    return fitFix(plan, finding.sceneIndex, "subScale", step);
  }

  const max =
    finding.path.endsWith(".title") && finding.path.includes(".callouts.") ? 22
      : finding.path.endsWith(".body") && finding.path.includes(".callouts.") ? 40
        : finding.path.endsWith(".title") ? 24
          : finding.path.endsWith(".text") ? 42
            : finding.path.endsWith(".sub") ? 64
              : finding.path.endsWith(".pill") ? 18
                : finding.path.endsWith(".label") ? 16
                  : finding.path.endsWith(".valueLabel") ? 16
                    : 40;
  return { op: "replace" as const, path: finding.path, value: truncateWords(finding.text, max) };
}

function toIssues(plan: VideoPlan, findings: RawDomFinding[]): QAIssue[] {
  const issues: QAIssue[] = [];
  for (const finding of findings) {
    const severity =
      finding.kind === "overflow" || finding.kind === "overlap"
        ? "major"
        : finding.kind === "safe"
          ? finding.path.includes(".callouts.")
            ? "major"
            : "minor"
          : "minor";
    const fix = fixForFinding(plan, finding);
    issues.push({
      id: `dom-${issues.length + 1}`,
      critic: "dom",
      severity,
      atMs: finding.atMs ?? 0,
      sceneId: plan.scenes[finding.sceneIndex]?.id,
      code: `dom_${finding.kind}`,
      message: `${finding.detail}: ${finding.text}`,
      evidence: { selector: finding.path, metric: finding.metric },
      ...(fix ? { fix } : {}),
    });
  }
  return issues;
}

export async function auditDom(htmlPath: string, plan: VideoPlan): Promise<QAIssue[]> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: plan.width, height: plan.height },
    deviceScaleFactor: 1,
  });

  const consoleErrors: string[] = [];
  const onConsole = (message: ConsoleMessage) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  };
  page.on("console", onConsole);
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  try {
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
    await page.waitForFunction("window.__auteurReady === true", { timeout: 15000 });
    await page.waitForTimeout(150);

    const collected = new Map<string, RawDomFinding>();
    for (const time of sampleTimes(plan)) {
      await page.evaluate(
        `(async () => { window.__auteur.seek(${time}); await new Promise(function (resolve) { setTimeout(resolve, 70); }); })()`,
      );
      const raw = (await page.evaluate(DOM_AUDIT_SCRIPT)) as RawDomFinding[];
      for (const finding of raw) {
        const key = `${finding.kind}:${finding.path}:${finding.sceneIndex}`;
        if (!collected.has(key)) collected.set(key, { ...finding, atMs: time });
      }
    }

    const issues = toIssues(plan, [...collected.values()]);
    if (consoleErrors.length > 0) {
      issues.push({
        id: "dom-console",
        critic: "dom",
        severity: "blocker",
        atMs: 0,
        code: "dom_console_error",
        message: `Browser console errors: ${consoleErrors.slice(0, 3).join(" | ")}`,
      });
    }

    return issues;
  } catch (error) {
    log.warn(`DOM audit failed: ${error instanceof Error ? error.message : String(error)}`);
    return [
      {
        id: "dom-audit-failed",
        critic: "dom",
        severity: "major",
        atMs: 0,
        code: "dom_audit_failed",
        message: `DOM audit could not run: ${error instanceof Error ? error.message : String(error)}`,
      },
    ];
  } finally {
    page.off("console", onConsole);
    await browser.close().catch(() => undefined);
  }
}

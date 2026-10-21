import type { SceneSpec, UiBlock, VideoPlan } from "../../plans/schema.js";
import type { LookTokens, Tokens } from "../tokens.js";

export const TEMPLATE_VERSION = "7";

export interface TemplateAssets {
  gsapJs: string;
  fonts: Array<{ weight: number; base64: string }>;
}

export interface AuteurSceneMeta {
  id: string;
  startMs: number;
  durationMs: number;
  keyFrames: number[];
}

export interface AuteurMeta {
  compositionId: "main";
  fps: number;
  durationMs: number;
  width: number;
  height: number;
  scenes: AuteurSceneMeta[];
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function attr(value: string): string {
  return escapeHtml(value).replace(/\n/g, " ");
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(3);
}

function channel(hex: string, offset: number): number {
  const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const clean = hex.replace("#", "");
  return 0.2126 * channel(clean, 0) + 0.7152 * channel(clean, 2) + 0.0722 * channel(clean, 4);
}

function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

function accentInkFor(accent: string): string {
  return contrastRatio(accent, "#FFFFFF") >= contrastRatio(accent, "#0A0A0A")
    ? "#FFFFFF"
    : "#0A0A0A";
}

function fitStyle(scene: SceneSpec): string {
  const headline = scene.fit?.headlineScale ?? 1;
  const sub = scene.fit?.subScale ?? 1;
  return `--headline-scale:${headline.toFixed(3)};--sub-scale:${sub.toFixed(3)};`;
}

function planPath(...parts: Array<string | number>): string {
  return parts.reduce<string>((acc, part) => {
    if (typeof part === "number") return `${acc}.${part}`;
    return acc ? `${acc}.${part}` : part;
  }, "");
}

function renderBlock(block: UiBlock, sceneIndex: number, blockIndex: number): string {
  const base = `scenes.${sceneIndex}.screen.blocks.${blockIndex}`;
  const blockAttr = `data-block-index="${blockIndex}" data-auteur-role="ui"`;

  if (block.kind === "header") {
    return `
      <div class="ui-block ui-header" ${blockAttr}>
        <div class="ui-header-copy">
          <div class="ui-title" data-auteur-role="text" data-plan-path="${attr(`${base}.text`)}">${escapeHtml(block.text)}</div>
          ${block.sub ? `<div class="ui-sub" data-auteur-role="text" data-plan-path="${attr(`${base}.sub`)}">${escapeHtml(block.sub)}</div>` : ""}
        </div>
        ${block.pill ? `<span class="pill" data-auteur-role="text" data-plan-path="${attr(`${base}.pill`)}">${escapeHtml(block.pill)}</span>` : ""}
      </div>`;
  }

  if (block.kind === "cards") {
    const columns = Math.max(2, Math.min(3, block.items.length));
    const cards = block.items
      .map((item, cardIndex) => {
        const itemBase = `${base}.items.${cardIndex}`;
        return `
          <div class="ui-card" data-auteur-role="text">
            <div class="ui-card-title" data-plan-path="${attr(`${itemBase}.title`)}">${escapeHtml(item.title)}</div>
            ${item.body ? `<div class="ui-card-body" data-plan-path="${attr(`${itemBase}.body`)}">${escapeHtml(item.body)}</div>` : ""}
            ${item.stat ? `<div class="ui-card-stat" data-plan-path="${attr(`${itemBase}.stat`)}">${escapeHtml(item.stat)}</div>` : ""}
          </div>`;
      })
      .join("");
    return `
      <div class="ui-block ui-cards" ${blockAttr} style="grid-template-columns:repeat(${columns},minmax(0,1fr))">
        ${cards}
      </div>`;
  }

  if (block.kind === "chart") {
    const bars = block.bars
      .map((value, barIndex) => {
        const height = Math.max(5, Math.round(value * 100));
        return `<div class="bar bar-${barIndex}" style="height:${height}%"></div>`;
      })
      .join("");
    return `
      <div class="ui-block ui-chart" ${blockAttr}>
        <div class="chart-head">
          <div class="chart-label" data-auteur-role="text" data-plan-path="${attr(`${base}.label`)}">${escapeHtml(block.label)}</div>
          ${block.valueLabel ? `<div class="chart-value" data-auteur-role="text" data-plan-path="${attr(`${base}.valueLabel`)}">${escapeHtml(block.valueLabel)}</div>` : ""}
        </div>
        <div class="chart-bars">${bars}</div>
      </div>`;
  }

  if (block.kind === "stat") {
    return `
      <div class="ui-block ui-stat-block" ${blockAttr}>
        <div class="ui-stat-value" data-auteur-role="text" data-plan-path="${attr(`${base}.value`)}">${escapeHtml(block.value)}</div>
        <div class="ui-stat-label" data-auteur-role="text" data-plan-path="${attr(`${base}.label`)}">${escapeHtml(block.label)}</div>
        ${block.sub ? `<div class="ui-stat-sub" data-auteur-role="text" data-plan-path="${attr(`${base}.sub`)}">${escapeHtml(block.sub)}</div>` : ""}
      </div>`;
  }

  if (block.kind === "quote") {
    return `
      <div class="ui-block ui-quote-block" ${blockAttr}>
        <div class="quote-text" data-auteur-role="text" data-plan-path="${attr(`${base}.text`)}">“${escapeHtml(block.text)}”</div>
        ${block.attribution ? `<div class="quote-attribution" data-auteur-role="text" data-plan-path="${attr(`${base}.attribution`)}">${escapeHtml(block.attribution)}</div>` : ""}
      </div>`;
  }

  const rows = block.rows
    .map((row, rowIndex) => {
      return `
        <div class="list-row" data-auteur-role="text">
          <span class="list-dot"></span>
          <span data-plan-path="${attr(`${base}.rows.${rowIndex}`)}">${escapeHtml(row)}</span>
        </div>`;
    })
    .join("");
  return `
    <div class="ui-block ui-list" ${blockAttr}>
      ${rows}
    </div>`;
}

function renderCopy(scene: SceneSpec, plan: VideoPlan, sceneIndex: number, sceneNumber: string): string {
  return `
    <div class="eyebrow anim" data-auteur-role="text" data-plan-path="${attr(planPath("brand", "name"))}">
      <span class="eyebrow-line"></span>${escapeHtml(plan.brand.name)} / ${sceneNumber}
    </div>
    <h1 class="headline anim" data-auteur-role="text" data-plan-path="${attr(planPath("scenes", sceneIndex, "copy", "headline"))}">${escapeHtml(scene.copy.headline)}</h1>
    ${scene.copy.sub ? `<p class="sub anim" data-auteur-role="text" data-plan-path="${attr(planPath("scenes", sceneIndex, "copy", "sub"))}">${escapeHtml(scene.copy.sub)}</p>` : ""}
    <div class="accent-rule anim"></div>
    <div class="brandline anim">
      <span>${escapeHtml(plan.brand.url ?? plan.brand.name)}</span>
      ${plan.brand.tagline ? `<span>${escapeHtml(plan.brand.tagline)}</span>` : ""}
    </div>`;
}

function hookStat(blocks: UiBlock[]): { value: string; label: string; path?: string } {
  const block =
    blocks.find(
      (candidate) =>
        candidate.kind === "stat" ||
        candidate.kind === "cards" ||
        candidate.kind === "chart",
    ) ?? blocks[0];
  if (!block) return { value: "01", label: "Start" };
  if (block.kind === "stat") {
    return { value: block.value, label: block.label };
  }
  if (block.kind === "cards") {
    const first = block.items[0];
    return { value: first?.stat ?? "01", label: first?.title ?? "Start" };
  }
  if (block.kind === "chart") {
    return { value: block.valueLabel ?? "01", label: block.label };
  }
  if (block.kind === "header") {
    return { value: block.pill ?? "01", label: block.text };
  }
  return { value: "01", label: "Start" };
}

function renderNote(scene: SceneSpec, sceneIndex: number): string {
  const callout = scene.callouts[0];
  if (!callout) return "";
  const base = `scenes.${sceneIndex}.callouts.0`;
  return `
    <div class="type-note anim">
      <span data-auteur-role="text" data-plan-path="${attr(`${base}.title`)}">${escapeHtml(callout.title)}</span>
      ${callout.body ? `<p data-auteur-role="text" data-plan-path="${attr(`${base}.body`)}">${escapeHtml(callout.body)}</p>` : ""}
    </div>`;
}

function renderCallouts(scene: SceneSpec, sceneIndex: number): string {
  return scene.callouts
    .map((callout, calloutIndex) => {
      const base = `scenes.${sceneIndex}.callouts.${calloutIndex}`;
      return `
        <div class="callout callout-${calloutIndex}" data-callout-index="${calloutIndex}" data-anchor-block="${callout.blockIndex}" data-side="right" data-auteur-role="callout">
          <div class="callout-title" data-auteur-role="text" data-plan-path="${attr(`${base}.title`)}">${escapeHtml(callout.title)}</div>
          ${callout.body ? `<div class="callout-body" data-auteur-role="text" data-plan-path="${attr(`${base}.body`)}">${escapeHtml(callout.body)}</div>` : ""}
        </div>`;
    })
    .join("");
}

function renderScene(scene: SceneSpec, plan: VideoPlan, sceneIndex: number): string {
  const layout = scene.layout;
  const blocks = scene.screen.blocks
    .map((block, blockIndex) => renderBlock(block, sceneIndex, blockIndex))
    .join("");
  const callouts = renderCallouts(scene, sceneIndex);
  const deviceClass = scene.device.model === "phone" ? "phone" : "laptop";
  const sceneNumber = String(sceneIndex + 1).padStart(2, "0");
  const total = String(plan.scenes.length).padStart(2, "0");
  const copy = renderCopy(scene, plan, sceneIndex, sceneNumber);
  const note = renderNote(scene, sceneIndex);
  const sceneIndexMarkup = `<div class="scene-index">${sceneNumber} / ${total}</div>`;

  let content = "";

  if (layout === "data") {
    content = `
      <div class="data-deck">
        <div class="copy data-copy" style="${fitStyle(scene)}">${copy}</div>
        ${note}
        <div class="stage data-stage">
          <div class="data-surface">${blocks}</div>
        </div>
      </div>`;
  } else if (layout === "type") {
    content = `
      <div class="type-deck">
        <div class="copy type-copy" style="${fitStyle(scene)}">${copy}</div>
        ${note}
      </div>`;
  } else if (layout === "hook") {
    const stat = hookStat(scene.screen.blocks);
    content = `
      <div class="hook-deck">
        <div class="copy hook-copy" style="${fitStyle(scene)}">
          ${copy}
          <div class="hook-stat anim">
            <div class="hook-value">${escapeHtml(stat.value)}</div>
            <div class="hook-label">${escapeHtml(stat.label)}</div>
          </div>
        </div>
        ${note}
      </div>`;
  } else {
    content = `
      <div class="deck">
        <div class="copy" style="${fitStyle(scene)}">${copy}</div>
        <div class="stage">
          <div class="device ${deviceClass}">
            <div class="screen">
              <div class="chrome">
                <div class="traffic"><i></i><i></i><i></i></div>
                <div class="chrome-title" data-auteur-role="text" data-plan-path="${attr(planPath("scenes", sceneIndex, "screen", "appName"))}">${escapeHtml(scene.screen.appName)}</div>
                <div class="chrome-spacer"></div>
              </div>
              <div class="app">
                ${blocks}
                <div class="app-footer"><span>${escapeHtml(plan.brand.url ?? plan.brand.name)}</span><span>Preview</span></div>
              </div>
            </div>
            ${deviceClass === "laptop" ? `<div class="base"></div>` : ""}
          </div>
          ${callouts}
        </div>
      </div>`;
  }

  return `
    <section class="scene clip layout-${layout}" id="scene-${sceneIndex}" data-layout="${layout}" data-start="${seconds(scene.startMs)}" data-duration="${seconds(scene.durationMs)}" data-track-index="0" data-auteur-id="${attr(scene.id)}" data-plan-scene="${sceneIndex}">
      <div class="scene-inner">
        ${content}
        ${sceneIndexMarkup}
      </div>
    </section>`;
}

function buildCss(plan: VideoPlan, tokens: Tokens, look: LookTokens): string {
  const ratioClass = plan.ratio === "16:9" ? "ratio-16x9" : "ratio-9x16";
  return `
    :root {
      --bg:${look.bg};
      --bg-alt:${look.bgAlt};
      --surface:${look.surface};
      --surface-2:${look.surface2};
      --text:${look.text};
      --muted:${look.muted};
      --line:${look.line};
      --grid:${look.grid};
      --accent:${plan.brand.accent};
      --accent-ink:${accentInkFor(plan.brand.accent)};
      --h1:${tokens.type.h1}px;
      --sub:${tokens.type.body - 1}px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: ${plan.width}px;
      height: ${plan.height}px;
      overflow: hidden;
      background: var(--bg);
    }
    body {
      font-family: "Auteur Inter", "Auteur CJK", sans-serif;
      color: var(--text);
      -webkit-font-smoothing: antialiased;
      text-rendering: geometricPrecision;
    }
    .frame {
      position: relative;
      width: ${plan.width}px;
      height: ${plan.height}px;
      overflow: hidden;
      background: var(--bg);
    }
    .backdrop {
      position: absolute;
      inset: 0;
      z-index: 0;
      background:
        radial-gradient(900px 620px at 78% 4%, var(--accent), transparent 58%),
        linear-gradient(180deg, var(--bg) 0%, var(--bg-alt) 100%);
      opacity: .16;
    }
    .backdrop::after {
      content: "";
      position: absolute;
      inset: 0;
      background-image:
        linear-gradient(var(--grid) 1px, transparent 1px),
        linear-gradient(90deg, var(--grid) 1px, transparent 1px);
      background-size: 64px 64px;
      mask-image: linear-gradient(to bottom, rgba(0,0,0,.9), transparent 78%);
    }
    .grain {
      position: absolute;
      inset: 0;
      z-index: 1;
      pointer-events: none;
      opacity: .045;
      mix-blend-mode: soft-light;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.55'/%3E%3C/svg%3E");
    }
    .vignette {
      position: absolute;
      inset: 0;
      z-index: 1;
      pointer-events: none;
      background: radial-gradient(ellipse at center, transparent 52%, rgba(0,0,0,.42) 100%);
    }
    .look-paper .backdrop { opacity: .1; }
    .look-paper .grain { opacity: .03; }
    .look-paper .vignette { background: radial-gradient(ellipse at center, transparent 62%, rgba(0,0,0,.10) 100%); }

    .topline {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      z-index: 30;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 44px 84px;
      color: var(--muted);
      font-size: 11px;
      letter-spacing: .18em;
      text-transform: uppercase;
    }
    .topline .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--text);
      font-weight: 600;
    }
    .topline .brand::before {
      content: "";
      width: 6px;
      height: 6px;
      background: var(--accent);
    }
    .topline .topline-right { opacity: 1; }

    .progress {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 2px;
      z-index: 40;
      background: var(--line);
    }
    .progress-fill {
      width: 100%;
      height: 100%;
      background: var(--accent);
      transform-origin: left center;
    }
    .scene-mode .progress,
    .scene-mode .scene-index { display: none; }

    .scene { position: absolute; inset: 0; z-index: 2; }
    .scene-inner { position: absolute; inset: 0; }
    .deck {
      position: relative;
      z-index: 2;
      height: 100%;
      display: grid;
      grid-template-columns: .82fr 1.18fr;
      gap: 52px;
      align-items: center;
      padding: 120px 84px 88px;
    }
    .copy { max-width: 650px; min-width: 0; }
    .eyebrow {
      display: flex;
      align-items: center;
      gap: 12px;
      color: var(--accent);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: .2em;
      text-transform: uppercase;
      margin-bottom: 24px;
    }
    .eyebrow-line { width: 28px; height: 1px; background: var(--accent); opacity: .8; }
    .headline {
      font-size: calc(var(--h1) * var(--headline-scale, 1));
      line-height: .96;
      letter-spacing: -.045em;
      font-weight: 600;
      color: var(--text);
      white-space: pre-line;
      text-wrap: balance;
    }
    .sub {
      margin-top: 24px;
      max-width: 520px;
      font-size: calc(var(--sub) * var(--sub-scale, 1));
      line-height: 1.45;
      letter-spacing: -.012em;
      color: var(--muted);
    }
    .accent-rule {
      width: 52px;
      height: 2px;
      background: var(--accent);
      margin-top: 30px;
    }
    .brandline {
      margin-top: 38px;
      padding-top: 16px;
      border-top: 1px solid var(--line);
      display: flex;
      gap: 16px;
      align-items: center;
      max-width: 560px;
      color: var(--muted);
      font-size: 10px;
      letter-spacing: .16em;
      text-transform: uppercase;
    }
    .brandline span:first-child { color: var(--text); }

    .stage {
      position: relative;
      min-width: 0;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: flex-start;
      transform-origin: center center;
    }
    .stage::before {
      content: "";
      position: absolute;
      width: 64%;
      height: 58%;
      background: var(--accent);
      filter: blur(90px);
      opacity: .10;
      border-radius: 50%;
    }
    .device {
      position: relative;
      z-index: 2;
      background: #05070a;
      border: 1px solid var(--line);
      box-shadow: 0 42px 90px rgba(0,0,0,.48), 0 8px 24px rgba(0,0,0,.28);
    }
    .look-paper .device { box-shadow: 0 32px 70px rgba(23,24,26,.20), 0 6px 18px rgba(23,24,26,.10); }
    .device.laptop {
      width: 740px;
      padding: 10px;
      border-radius: 18px;
    }
    .device.phone {
      width: 356px;
      height: 720px;
      padding: 9px;
      border-radius: 52px;
    }
    .base {
      position: relative;
      height: 12px;
      margin: 0 -1px;
      border-radius: 0 0 14px 14px;
      background: linear-gradient(180deg, #1a2029 0%, #0a0d12 100%);
      border: 1px solid var(--line);
      border-top: 0;
      z-index: 0;
    }
    .screen {
      position: relative;
      z-index: 1;
      height: 500px;
      overflow: hidden;
      border-radius: 12px;
      background: var(--surface-2);
    }
    .device.phone .screen { height: 100%; border-radius: 44px; }
    .chrome {
      height: 44px;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 0 18px;
      background: var(--surface-2);
      border-bottom: 1px solid var(--line);
      position: relative;
      z-index: 2;
    }
    .traffic { display: flex; gap: 6px; align-items: center; width: 54px; }
    .traffic i { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); opacity: .38; display: block; }
    .chrome-title {
      color: var(--muted);
      font-size: 11px;
      letter-spacing: .1em;
      text-transform: uppercase;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .chrome-spacer { flex: 1; }
    .device.phone .chrome { height: 36px; justify-content: center; }
    .device.phone .traffic { display: none; }
    .device.phone .chrome-spacer { display: none; }
    .device.phone .chrome-title { display: none; }
    .device.phone .chrome::before {
      content: "";
      position: absolute;
      top: 7px;
      left: 50%;
      transform: translateX(-50%);
      width: 72px;
      height: 16px;
      border-radius: 12px;
      background: #05070a;
    }

    .app {
      height: calc(100% - 44px);
      padding: 20px 24px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      overflow: hidden;
      position: relative;
      z-index: 2;
    }
    .device.phone .app { height: calc(100% - 36px); padding: 30px 16px 20px; gap: 12px; }
    .ui-block { flex-shrink: 0; }
    .app-footer {
      margin-top: auto;
      padding-top: 12px;
      border-top: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: var(--muted);
      font-size: 9px;
      letter-spacing: .14em;
      text-transform: uppercase;
    }
    .app-footer span:first-child::before {
      content: "";
      display: inline-block;
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: var(--accent);
      margin-right: 7px;
      vertical-align: 1px;
    }
    .ui-header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 18px;
      padding: 2px 2px 14px;
      border-bottom: 1px solid var(--line);
    }
    .ui-title { font-size: 28px; line-height: 1.05; letter-spacing: -.035em; font-weight: 600; }
    .ui-sub { margin-top: 8px; color: var(--muted); font-size: 12px; line-height: 1.35; }
    .pill {
      flex-shrink: 0;
      background: var(--accent);
      color: var(--accent-ink);
      border-radius: 999px;
      padding: 8px 11px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: .14em;
      text-transform: uppercase;
    }
    .ui-cards { display: grid; gap: 12px; }
    .ui-card {
      border: 1px solid var(--line);
      background: var(--surface);
      border-radius: 16px;
      padding: 18px 16px;
      min-height: 118px;
      display: flex;
      flex-direction: column;
      gap: 9px;
    }
    .ui-card-title { color: var(--muted); font-size: 10px; letter-spacing: .13em; text-transform: uppercase; }
    .ui-card-body { color: var(--muted); font-size: 12px; line-height: 1.35; }
    .ui-card-stat { margin-top: auto; font-size: 28px; line-height: 1; font-weight: 600; letter-spacing: -.045em; color: var(--text); }
    .ui-chart {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 16px 18px 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .chart-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
    .chart-label { color: var(--muted); font-size: 10px; letter-spacing: .13em; text-transform: uppercase; }
    .chart-value { font-size: 26px; line-height: .9; font-weight: 600; letter-spacing: -.04em; }
    .chart-bars { display: flex; align-items: flex-end; gap: 9px; height: 100px; }
    .bar {
      flex: 1;
      background: var(--accent);
      border-radius: 3px 3px 1px 1px;
      opacity: .9;
      min-height: 5px;
      transform-origin: bottom center;
    }
    .bar:nth-child(even) { opacity: .55; }
    .ui-list {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 2px 18px;
    }
    .list-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid var(--line);
      color: var(--text);
      font-size: 13px;
      line-height: 1.3;
    }
    .list-row:last-child { border-bottom: 0; }
    .list-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--accent); flex-shrink: 0; }

    .callout {
      position: absolute;
      z-index: 12;
      width: 214px;
      padding: 13px 15px;
      background: var(--surface);
      border: 1px solid var(--line);
      border-left: 2px solid var(--accent);
      border-radius: 12px;
      box-shadow: 0 18px 44px rgba(0,0,0,.32);
      pointer-events: none;
    }
    .look-paper .callout { box-shadow: 0 16px 34px rgba(23,24,26,.14); }
    .callout::before {
      content: "";
      position: absolute;
      top: 24px;
      left: -25px;
      width: 23px;
      height: 1px;
      background: var(--accent);
      opacity: .75;
    }
    .callout[data-side="left"] { border-left: 1px solid var(--line); border-right: 2px solid var(--accent); }
    .callout[data-side="left"]::before { left: auto; right: -25px; }
    .callout-title { font-size: 13px; line-height: 1.25; font-weight: 600; letter-spacing: -.01em; }
    .callout-body { margin-top: 5px; color: var(--muted); font-size: 12px; line-height: 1.4; }

    .scene-index {
      position: absolute;
      bottom: 42px;
      right: 84px;
      z-index: 6;
      color: var(--muted);
      font-size: 10px;
      letter-spacing: .16em;
      opacity: 1;
    }

    /* CJK typography */
    .lang-zh .headline {
      letter-spacing: -.02em;
      line-height: 1.08;
      word-break: normal;
      overflow-wrap: anywhere;
    }
    .lang-zh .sub {
      letter-spacing: 0;
      line-height: 1.6;
    }
    .lang-zh .type-copy .headline {
      letter-spacing: -.03em;
      line-height: 1.02;
    }

    /* Stat / quote blocks */
    .ui-stat-block {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 20px 18px;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .ui-stat-value { font-size: 42px; line-height: .95; font-weight: 600; letter-spacing: -.05em; }
    .ui-stat-label { color: var(--muted); font-size: 10px; letter-spacing: .13em; text-transform: uppercase; }
    .ui-stat-sub { color: var(--muted); font-size: 12px; line-height: 1.35; }
    .ui-quote-block {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 24px;
    }
    .quote-text { font-size: 24px; line-height: 1.22; letter-spacing: -.025em; font-weight: 500; }
    .quote-attribution { color: var(--muted); font-size: 10px; letter-spacing: .13em; text-transform: uppercase; margin-top: 16px; }

    /* Data layout */
    .data-deck {
      position: absolute;
      inset: 0;
      z-index: 2;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 28px;
      padding: 112px 84px 82px;
    }
    .data-copy { max-width: 820px; }
    .data-copy .headline { font-size: calc(var(--h1) * .82); }
    .data-stage {
      position: relative;
      flex: 1;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      transform-origin: center center;
    }
    .data-surface {
      width: 100%;
      max-height: 100%;
      overflow: hidden;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 20px;
      padding: 24px 26px;
      display: flex;
      flex-direction: column;
      gap: 15px;
      box-shadow: 0 34px 80px rgba(0,0,0,.28);
    }
    .look-paper .data-surface { box-shadow: 0 26px 60px rgba(23,24,26,.13); }
    .data-surface .ui-header { padding-bottom: 12px; }
    .data-surface .ui-title { font-size: 36px; }
    .data-surface .ui-sub { font-size: 13px; }
    .data-surface .ui-cards { gap: 12px; }
    .data-surface .ui-card { min-height: 132px; }
    .data-surface .ui-card-stat { font-size: 36px; }
    .data-surface .ui-chart { padding: 18px 20px 14px; }
    .data-surface .chart-bars { height: 156px; }
    .data-surface .chart-value { font-size: 32px; }
    .data-surface .ui-stat-value { font-size: 54px; }
    .data-surface .quote-text { font-size: 30px; }

    /* Type layout */
    .type-deck {
      position: absolute;
      inset: 0;
      z-index: 2;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 136px 84px 96px;
      overflow: hidden;
    }
    .type-copy { position: relative; z-index: 2; max-width: 1460px; }
    .type-copy .headline {
      font-size: 122px;
      line-height: .93;
      letter-spacing: -.055em;
      max-width: 1460px;
    }
    .type-copy .sub { font-size: 26px; max-width: 720px; margin-top: 28px; }
    .type-copy .accent-rule { margin-top: 34px; }
    .type-copy .brandline { max-width: 640px; margin-top: 40px; }
    .type-note {
      position: relative;
      z-index: 2;
      margin-top: 32px;
      max-width: 620px;
      padding-left: 16px;
      border-left: 2px solid var(--accent);
    }
    .type-note > span {
      color: var(--accent);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: .13em;
      text-transform: uppercase;
    }
    .type-note p {
      margin: 5px 0 0;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.45;
    }

    /* Hook layout */
    .hook-deck {
      position: absolute;
      inset: 0;
      z-index: 2;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 136px 84px 96px;
      overflow: hidden;
    }
    .hook-copy { position: relative; z-index: 2; max-width: 1420px; }
    .hook-copy .headline { font-size: 86px; line-height: .96; letter-spacing: -.045em; }
    .hook-copy .sub { font-size: 23px; max-width: 680px; }
    .hook-stat {
      display: flex;
      align-items: baseline;
      gap: 20px;
      margin-top: 30px;
      padding-top: 22px;
      border-top: 1px solid var(--line);
      max-width: 1000px;
    }
    .hook-value { color: var(--accent); font-size: 160px; line-height: .98; font-weight: 600; letter-spacing: -.07em; white-space: nowrap; }
    .hook-label { color: var(--muted); font-size: 13px; letter-spacing: .13em; text-transform: uppercase; max-width: 260px; line-height: 1.35; }
    .hook-deck .type-note { margin-top: 24px; }

    .data-deck .type-note { margin-top: -6px; max-width: 760px; }
    .ratio-9x16 .data-deck { padding: 92px 56px 70px; gap: 22px; }
    .ratio-9x16 .data-copy .headline { font-size: 50px; }
    .ratio-9x16 .data-surface { padding: 18px; gap: 12px; }
    .ratio-9x16 .data-surface .ui-title { font-size: 28px; }
    .ratio-9x16 .data-surface .chart-bars { height: 120px; }
    .ratio-9x16 .type-deck,
    .ratio-9x16 .hook-deck { padding: 112px 56px 80px; }
    .ratio-9x16 .type-copy .headline { font-size: 72px; letter-spacing: -.04em; }
    .ratio-9x16 .type-copy .sub { font-size: 20px; }
    .ratio-9x16 .type-note p { font-size: 14px; }
    .ratio-9x16 .hook-copy .headline { font-size: 58px; }
    .ratio-9x16 .hook-copy .sub { font-size: 19px; }
    .ratio-9x16 .hook-value { font-size: 112px; }

    .ratio-9x16 .deck {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: stretch;
      gap: 36px;
      padding: 110px 56px 80px;
    }
    .ratio-9x16 .copy { width: 100%; max-width: none; }
    .ratio-9x16 .headline { --h1: 58px; }
    .ratio-9x16 .sub { --sub: 20px; max-width: 100%; }
    .ratio-9x16 .stage { width: 100%; height: auto; flex: 1; justify-content: center; }
    .ratio-9x16 .device.laptop { width: 680px; }
    .ratio-9x16 .device.laptop .screen { height: 420px; }
    .ratio-9x16 .topline { padding: 44px 56px; }
    .ratio-9x16 .scene-index { right: 56px; bottom: 38px; }

    .copy .anim, .ui-block, .ui-card, .list-row, .callout, .bar { opacity: 0; }

    .preview-bar {
      position: absolute;
      left: 50%;
      bottom: 24px;
      transform: translateX(-50%);
      z-index: 60;
      display: flex;
      align-items: center;
      gap: 12px;
      background: rgba(8,10,13,.86);
      border: 1px solid rgba(255,255,255,.16);
      padding: 10px 14px;
      border-radius: 14px;
      color: #fff;
      font: 12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .preview-bar input { width: 300px; accent-color: var(--accent); }
    .preview-bar button {
      background: var(--accent);
      color: var(--accent-ink);
      border: 0;
      padding: 7px 11px;
      border-radius: 8px;
      font: 700 11px/1 ui-monospace, monospace;
      cursor: pointer;
    }
    .preview-time { min-width: 70px; text-align: right; color: rgba(255,255,255,.7); }
  `;
}

function buildScript(plan: VideoPlan, meta: AuteurMeta, sceneMode = false): string {
  const totalSeconds = plan.durationMs / 1000;
  const visualScenes = plan.scenes.filter(
    (scene) => scene.layout === "device" || scene.layout === "data",
  );
  const allBlocks = visualScenes.flatMap((scene) => scene.screen.blocks);
  const anyCards = allBlocks.some((block) => block.kind === "cards");
  const anyChart = allBlocks.some((block) => block.kind === "chart");
  const anyList = allBlocks.some((block) => block.kind === "list");
  const anyCallouts = plan.scenes.some(
    (scene) => scene.layout === "device" && scene.callouts.length > 0,
  );
  const anyNotes = plan.scenes.some(
    (scene) => scene.layout !== "device" && scene.callouts.length > 0,
  );

  const lines: string[] = [];
  lines.push(`const tl = gsap.timeline({ paused: true });`);
  lines.push(`gsap.set(".scene-inner", { opacity: ${sceneMode ? 1 : 0} });`);
  lines.push(`gsap.set(".copy .anim", { opacity: 0, y: 22 });`);
  if (visualScenes.length > 0) lines.push(`gsap.set(".ui-block", { opacity: 0, y: 16 });`);
  if (anyCards) lines.push(`gsap.set(".ui-card", { opacity: 0, y: 14 });`);
  if (anyList) lines.push(`gsap.set(".list-row", { opacity: 0, y: 8 });`);
  if (anyCallouts) lines.push(`gsap.set(".callout", { opacity: 0, y: 8 });`);
  if (anyChart) lines.push(`gsap.set(".bar", { opacity: 1, scaleY: 0, transformOrigin: "bottom center" });`);
  if (anyNotes) lines.push(`gsap.set(".type-note", { opacity: 0, y: 12 });`);
  lines.push(`gsap.set(".progress-fill", { scaleX: 0, transformOrigin: "left center" });`);
  lines.push(`tl.to(".progress-fill", { scaleX: 1, duration: ${totalSeconds}, ease: "none" }, 0);`);

  for (const [index, scene] of plan.scenes.entries()) {
    const start = scene.startMs / 1000;
    const end = (scene.startMs + scene.durationMs) / 1000;
    const push = scene.transitionIn.type === "push";
    const selector = `#scene-${index}`;
    const visual = scene.layout === "device" || scene.layout === "data";
    const hasCards = visual && scene.screen.blocks.some((block) => block.kind === "cards");
    const hasChart = visual && scene.screen.blocks.some((block) => block.kind === "chart");
    const hasList = visual && scene.screen.blocks.some((block) => block.kind === "list");
    const hasNote = scene.layout !== "device" && scene.callouts.length > 0;

    if (!sceneMode) {
      lines.push(
        `tl.fromTo("${selector} .scene-inner", { opacity: 0, x: ${push ? 44 : 0}, y: ${push ? 0 : 16} }, { opacity: 1, x: 0, y: 0, duration: 0.46, ease: "power3.out" }, ${start.toFixed(3)});`,
      );
      if (index < plan.scenes.length - 1) {
        lines.push(
          `tl.to("${selector} .scene-inner", { opacity: 0, x: ${push ? -30 : 0}, y: ${push ? 0 : -12}, duration: 0.32, ease: "power2.in" }, ${(end - 0.32).toFixed(3)});`,
        );
      }
    }
    lines.push(
      `tl.to("${selector} .copy .anim", { opacity: 1, y: 0, duration: 0.56, stagger: 0.07, ease: "power3.out" }, ${(start + 0.08).toFixed(3)});`,
    );
    if (visual) {
      lines.push(
        `tl.to("${selector} .ui-block", { opacity: 1, y: 0, duration: 0.46, stagger: 0.08, ease: "power2.out" }, ${(start + 0.3).toFixed(3)});`,
      );
    }
    if (hasNote) {
      lines.push(
        `tl.to("${selector} .type-note", { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" }, ${(start + 0.42).toFixed(3)});`,
      );
    }
    if (hasCards) {
      lines.push(
        `tl.to("${selector} .ui-card", { opacity: 1, y: 0, duration: 0.4, stagger: 0.06, ease: "power2.out" }, ${(start + 0.44).toFixed(3)});`,
      );
    }
    if (hasList) {
      lines.push(
        `tl.to("${selector} .list-row", { opacity: 1, y: 0, duration: 0.34, stagger: 0.05, ease: "power2.out" }, ${(start + 0.5).toFixed(3)});`,
      );
    }
    if (hasChart) {
      lines.push(
        `tl.to("${selector} .bar", { scaleY: 1, duration: 0.56, stagger: 0.05, ease: "power3.out" }, ${(start + 0.46).toFixed(3)});`,
      );
    }

    if (scene.layout === "device") {
      for (const [calloutIndex, callout] of scene.callouts.entries()) {
        const enter = start + callout.enterMs / 1000;
        const exit = start + callout.exitMs / 1000;
        lines.push(
          `tl.to("${selector} .callout-${calloutIndex}", { opacity: 1, y: 0, duration: 0.32, ease: "power2.out" }, ${enter.toFixed(3)});`,
        );
        lines.push(
          `tl.to("${selector} .callout-${calloutIndex}", { opacity: 0, y: -6, duration: 0.22, ease: "power2.in" }, ${exit.toFixed(3)});`,
        );
      }
    }

    if (scene.layout === "device") {
      for (const [cameraIndex, camera] of scene.camera.entries()) {
        const at = start + camera.atMs / 1000;
        const nextAt = scene.camera[cameraIndex + 1]?.atMs ?? scene.durationMs;
        const gap = Math.max(0.25, (nextAt - camera.atMs) / 1000 - 0.05);
        const duration = Math.min(1.15, gap);
        lines.push(
          `tl.to("${selector} .stage", { scale: ${camera.scale}, duration: ${duration.toFixed(3)}, ease: "power2.inOut" }, ${at.toFixed(3)});`,
        );
      }
    }
  }

  const metaJson = JSON.stringify(meta).replace(/</g, "\\u003c");
  return `
    ${lines.join("\n    ")}
    window.__timelines = window.__timelines || {};
    window.__timelines["main"] = tl;
    window.__auteurReady = false;
    const __auteurMeta = ${metaJson};
    window.__auteur = {
      compositionId: "main",
      fps: ${meta.fps},
      durationMs: ${meta.durationMs},
      width: ${meta.width},
      height: ${meta.height},
      scenes: __auteurMeta.scenes,
      seek: (ms) => { tl.seek(Math.max(0, Math.min(ms, ${meta.durationMs})) / 1000); },
      getTime: () => tl.time() * 1000,
      timeline: tl
    };
    function placeCallouts() {
      document.querySelectorAll(".scene").forEach((scene) => {
        const stage = scene.querySelector(".stage");
        const screen = scene.querySelector(".screen, .data-surface");
        if (!stage || !screen) return;
        const stageRect = stage.getBoundingClientRect();
        scene.querySelectorAll(".callout").forEach((callout) => {
          const anchor = callout.getAttribute("data-anchor-block");
          const block = screen.querySelector('[data-block-index="' + anchor + '"]');
          if (!block) return;
          const blockRect = block.getBoundingClientRect();
          const width = callout.offsetWidth || 214;
          const height = callout.offsetHeight || 72;
          let side = "right";
          let left = blockRect.right - stageRect.left + 26;
          let top = blockRect.top - stageRect.top + Math.min(12, Math.max(0, (blockRect.height - height) / 2));
          if (left + width > stageRect.width - 8) {
            side = "left";
            left = blockRect.left - stageRect.left - width - 26;
          }
          left = Math.max(8, Math.min(left, stageRect.width - width - 8));
          top = Math.max(8, Math.min(top, stageRect.height - height - 8));
          callout.setAttribute("data-side", side);
          callout.style.left = left + "px";
          callout.style.top = top + "px";
        });
      });
    }
    function setupPreview() {
      if (!new URLSearchParams(location.search).has("preview")) return;
      const bar = document.createElement("div");
      bar.className = "preview-bar";
      bar.innerHTML = '<button type="button" data-play>PAUSE</button><input type="range" min="0" max="${meta.durationMs}" step="10" value="0" aria-label="Timeline"><span class="preview-time">0.00s</span>';
      document.querySelector(".frame")?.appendChild(bar);
      const play = bar.querySelector("[data-play]");
      const range = bar.querySelector("input");
      const time = bar.querySelector(".preview-time");
      const sync = () => {
        if (!range || !time) return;
        range.value = String(Math.round(tl.time() * 1000));
        time.textContent = tl.time().toFixed(2) + "s";
      };
      range?.addEventListener("input", () => {
        tl.pause();
        tl.seek(Number(range.value) / 1000);
        if (play) play.textContent = "PLAY";
        sync();
      });
      play?.addEventListener("click", () => {
        if (tl.paused()) {
          if (tl.time() >= ${totalSeconds} - 0.02) tl.seek(0);
          tl.play();
          if (play) play.textContent = "PAUSE";
        } else {
          tl.pause();
          if (play) play.textContent = "PLAY";
        }
      });
      tl.eventCallback("onUpdate", sync);
      sync();
    }
    document.fonts.ready.then(() => {
      placeCallouts();
      tl.seek(0);
      setupPreview();
      window.__auteurReady = true;
    });
    window.addEventListener("resize", () => { if (window.__auteurReady) placeCallouts(); });
  `;
}

export interface ProductUiRenderOptions {
  sceneMode?: boolean;
}

export function renderProductUi(
  plan: VideoPlan,
  tokens: Tokens,
  assets: TemplateAssets,
  options: ProductUiRenderOptions = {},
): string {
  const look = tokens.looks[plan.brand.look];
  const ratioClass = plan.ratio === "16:9" ? "ratio-16x9" : "ratio-9x16";
  const meta: AuteurMeta = {
    compositionId: "main",
    fps: plan.fps,
    durationMs: plan.durationMs,
    width: plan.width,
    height: plan.height,
    scenes: plan.scenes.map((scene) => {
      const keyFrames = new Set<number>([
        scene.startMs,
        scene.startMs + Math.round(scene.durationMs / 2),
        scene.startMs + scene.durationMs,
      ]);
      for (const callout of scene.callouts) {
        keyFrames.add(scene.startMs + callout.enterMs);
        keyFrames.add(scene.startMs + callout.exitMs);
      }
      return {
        id: scene.id,
        startMs: scene.startMs,
        durationMs: scene.durationMs,
        keyFrames: [...keyFrames].sort((a, b) => a - b),
      };
    }),
  };

  const fontFaces = `${
    assets.fonts
      .map(
        (font) => `@font-face{font-family:"Auteur Inter";font-style:normal;font-weight:${font.weight};font-display:block;src:url(data:font/woff2;base64,${font.base64}) format("woff2");}`,
      )
      .join("\n")
  }\n@font-face{font-family:"Auteur CJK";font-style:normal;font-weight:400 700;font-display:block;src:local("Microsoft YaHei"),local("PingFang SC"),local("Noto Sans SC"),local("Hiragino Sans GB"),local("Noto Sans CJK SC");}`;

  const css = `${fontFaces}\n${buildCss(plan, tokens, look)}`;
  const scenes = plan.scenes
    .map((scene, index) => renderScene(scene, plan, index))
    .join("\n");
  const script = buildScript(plan, meta, Boolean(options.sceneMode));
  const cjkText = [
    plan.brand.name,
    plan.brand.tagline ?? "",
    ...plan.scenes.flatMap((scene) => [
      scene.copy.headline,
      scene.copy.sub ?? "",
      ...scene.screen.blocks.flatMap((block) => {
        if (block.kind === "header") return [block.text, block.sub ?? "", block.pill ?? ""];
        if (block.kind === "cards") return block.items.flatMap((item) => [item.title, item.body ?? "", item.stat ?? ""]);
        if (block.kind === "chart") return [block.label, block.valueLabel ?? ""];
        if (block.kind === "list") return block.rows;
        if (block.kind === "stat") return [block.value, block.label, block.sub ?? ""];
        return [block.text, block.attribution ?? ""];
      }),
    ]),
  ].join(" ");
  const isCjk = /[\u3400-\u9fff]/.test(cjkText);

  return `<!doctype html>
<html lang="${isCjk ? "zh-CN" : "en"}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=${plan.width}, height=${plan.height}" />
  <title>${escapeHtml(plan.brand.name)} — ${escapeHtml(plan.id)}</title>
  <style>${css}</style>
</head>
<body>
  <div id="root" class="frame look-${plan.brand.look} ${ratioClass}${isCjk ? " lang-zh" : ""}${options.sceneMode ? " scene-mode" : ""}" data-composition-id="main" data-start="0" data-duration="${seconds(plan.durationMs)}" data-fps="${plan.fps}" data-width="${plan.width}" data-height="${plan.height}">
    <div class="backdrop"></div>
    <div class="grain"></div>
    <div class="vignette"></div>
    <div class="topline">
      <div class="brand">${escapeHtml(plan.brand.name)}</div>
      ${plan.brand.tagline ? `<div class="topline-right">${escapeHtml(plan.brand.tagline)}</div>` : ""}
    </div>
    ${scenes}
    <div class="progress"><div class="progress-fill"></div></div>
  </div>
  <script src="./gsap.min.js"></script>
  <script>${script}</script>
</body>
</html>`;
}

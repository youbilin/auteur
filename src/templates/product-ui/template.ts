import type { SceneSpec, UiBlock, VideoPlan } from "../../plans/schema.js";
import type { LookTokens, Tokens } from "../tokens.js";

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
  const blocks = scene.screen.blocks
    .map((block, blockIndex) => renderBlock(block, sceneIndex, blockIndex))
    .join("");
  const callouts = renderCallouts(scene, sceneIndex);
  const deviceClass = scene.device.model === "phone" ? "phone" : "laptop";
  const sceneNumber = String(sceneIndex + 1).padStart(2, "0");
  const total = String(plan.scenes.length).padStart(2, "0");

  return `
    <section class="scene clip" id="scene-${sceneIndex}" data-start="${seconds(scene.startMs)}" data-duration="${seconds(scene.durationMs)}" data-track-index="0" data-auteur-id="${attr(scene.id)}" data-plan-scene="${sceneIndex}">
      <div class="scene-inner">
        <div class="deck">
          <div class="copy" style="${fitStyle(scene)}">
            <div class="eyebrow anim" data-auteur-role="text" data-plan-path="${attr(planPath("brand", "name"))}">
              <span class="eyebrow-line"></span>${escapeHtml(plan.brand.name)} / ${sceneNumber}
            </div>
            <h1 class="headline anim" data-auteur-role="text" data-plan-path="${attr(planPath("scenes", sceneIndex, "copy", "headline"))}">${escapeHtml(scene.copy.headline)}</h1>
            ${scene.copy.sub ? `<p class="sub anim" data-auteur-role="text" data-plan-path="${attr(planPath("scenes", sceneIndex, "copy", "sub"))}">${escapeHtml(scene.copy.sub)}</p>` : ""}
            <div class="accent-rule anim"></div>
            <div class="brandline anim">
              <span>${escapeHtml(plan.brand.url ?? plan.brand.name)}</span>
              ${plan.brand.tagline ? `<span>${escapeHtml(plan.brand.tagline)}</span>` : ""}
            </div>
          </div>
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
        </div>
        <div class="scene-index">${sceneNumber} / ${total}</div>
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
      font-family: "Auteur Inter", "Segoe UI", system-ui, sans-serif;
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

function buildScript(plan: VideoPlan, meta: AuteurMeta): string {
  const totalSeconds = plan.durationMs / 1000;
  const allBlocks = plan.scenes.flatMap((scene) => scene.screen.blocks);
  const anyCards = allBlocks.some((block) => block.kind === "cards");
  const anyChart = allBlocks.some((block) => block.kind === "chart");
  const anyList = allBlocks.some((block) => block.kind === "list");
  const anyCallouts = plan.scenes.some((scene) => scene.callouts.length > 0);

  const lines: string[] = [];
  lines.push(`const tl = gsap.timeline({ paused: true });`);
  lines.push(`gsap.set(".scene-inner", { opacity: 0 });`);
  lines.push(`gsap.set(".copy .anim", { opacity: 0, y: 22 });`);
  lines.push(`gsap.set(".ui-block", { opacity: 0, y: 16 });`);
  if (anyCards) lines.push(`gsap.set(".ui-card", { opacity: 0, y: 14 });`);
  if (anyList) lines.push(`gsap.set(".list-row", { opacity: 0, y: 8 });`);
  if (anyCallouts) lines.push(`gsap.set(".callout", { opacity: 0, y: 8 });`);
  if (anyChart) lines.push(`gsap.set(".bar", { opacity: 1, scaleY: 0, transformOrigin: "bottom center" });`);
  lines.push(`gsap.set(".progress-fill", { scaleX: 0, transformOrigin: "left center" });`);
  lines.push(`tl.to(".progress-fill", { scaleX: 1, duration: ${totalSeconds}, ease: "none" }, 0);`);

  for (const [index, scene] of plan.scenes.entries()) {
    const start = scene.startMs / 1000;
    const end = (scene.startMs + scene.durationMs) / 1000;
    const push = scene.transitionIn.type === "push";
    const selector = `#scene-${index}`;
    const hasCards = scene.screen.blocks.some((block) => block.kind === "cards");
    const hasChart = scene.screen.blocks.some((block) => block.kind === "chart");
    const hasList = scene.screen.blocks.some((block) => block.kind === "list");

    lines.push(
      `tl.fromTo("${selector} .scene-inner", { opacity: 0, x: ${push ? 44 : 0}, y: ${push ? 0 : 16} }, { opacity: 1, x: 0, y: 0, duration: 0.46, ease: "power3.out" }, ${start.toFixed(3)});`,
    );
    if (index < plan.scenes.length - 1) {
      lines.push(
        `tl.to("${selector} .scene-inner", { opacity: 0, x: ${push ? -30 : 0}, y: ${push ? 0 : -12}, duration: 0.32, ease: "power2.in" }, ${(end - 0.32).toFixed(3)});`,
      );
    }
    lines.push(
      `tl.to("${selector} .copy .anim", { opacity: 1, y: 0, duration: 0.56, stagger: 0.07, ease: "power3.out" }, ${(start + 0.08).toFixed(3)});`,
    );
    lines.push(
      `tl.to("${selector} .ui-block", { opacity: 1, y: 0, duration: 0.46, stagger: 0.08, ease: "power2.out" }, ${(start + 0.3).toFixed(3)});`,
    );
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

    for (const camera of scene.camera) {
      const at = start + camera.atMs / 1000;
      lines.push(
        `tl.to("${selector} .stage", { scale: ${camera.scale}, duration: 1.15, ease: "power2.inOut" }, ${at.toFixed(3)});`,
      );
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
        const screen = scene.querySelector(".screen");
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

export function renderProductUi(plan: VideoPlan, tokens: Tokens, assets: TemplateAssets): string {
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

  const fontFaces = assets.fonts
    .map(
      (font) => `@font-face{font-family:"Auteur Inter";font-style:normal;font-weight:${font.weight};font-display:block;src:url(data:font/woff2;base64,${font.base64}) format("woff2");}`,
    )
    .join("\n");

  const css = `${fontFaces}\n${buildCss(plan, tokens, look)}`;
  const scenes = plan.scenes
    .map((scene, index) => renderScene(scene, plan, index))
    .join("\n");
  const script = buildScript(plan, meta);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=${plan.width}, height=${plan.height}" />
  <title>${escapeHtml(plan.brand.name)} — ${escapeHtml(plan.id)}</title>
  <style>${css}</style>
</head>
<body>
  <div id="root" class="frame look-${plan.brand.look} ${ratioClass}" data-composition-id="main" data-start="0" data-duration="${seconds(plan.durationMs)}" data-fps="${plan.fps}" data-width="${plan.width}" data-height="${plan.height}">
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

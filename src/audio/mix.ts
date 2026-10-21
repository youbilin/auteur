import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ensureDir, readJson, runDir } from "../core/paths.js";
import { log } from "../core/log.js";
import type { VideoPlan } from "../plans/schema.js";

export interface AudioConfig {
  enabled: boolean;
  targetLufs: number;
  truePeakDb: number;
  loudnessRange: number;
  bedLevel: number;
  sfxLevel: number;
  fadeInMs: number;
  fadeOutMs: number;
  whooshLeadMs: number;
}

const DEFAULT_CONFIG: AudioConfig = {
  enabled: true,
  targetLufs: -16,
  truePeakDb: -1.5,
  loudnessRange: 11,
  bedLevel: 0.9,
  sfxLevel: 0.9,
  fadeInMs: 600,
  fadeOutMs: 900,
  whooshLeadMs: 120,
};

export function loadAudioConfig(root = process.cwd()): AudioConfig {
  const file = path.join(root, "config", "audio.json");
  if (!fs.existsSync(file)) return DEFAULT_CONFIG;
  return { ...DEFAULT_CONFIG, ...readJson<Partial<AudioConfig>>(file) };
}

function ffmpeg(args: string[], label: string): void {
  const result = spawnSync("ffmpeg", ["-y", "-v", "error", ...args], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${(result.stderr ?? "").slice(-1200)}`);
  }
}

interface SfxEvent {
  kind: "whoosh" | "tick";
  atMs: number;
}

function buildSfxEvents(plan: VideoPlan, config: AudioConfig): SfxEvent[] {
  const events: SfxEvent[] = [];
  for (const scene of plan.scenes) {
    if (scene.startMs > 0) {
      events.push({ kind: "whoosh", atMs: Math.max(0, scene.startMs - config.whooshLeadMs) });
    }
    for (const callout of scene.callouts) {
      events.push({ kind: "tick", atMs: scene.startMs + callout.enterMs });
    }
  }
  return events.sort((a, b) => a.atMs - b.atMs);
}

function makeWhoosh(file: string): void {
  ffmpeg(
    [
      "-f", "lavfi", "-i", "anoisesrc=color=white:amplitude=0.16:d=0.45:r=48000",
      "-af", "highpass=f=700,lowpass=f=5200,afade=t=in:st=0:d=0.03,afade=t=out:st=0.12:d=0.33,volume=0.9",
      "-c:a", "pcm_s16le", file,
    ],
    "whoosh generation",
  );
}

function makeTick(file: string): void {
  ffmpeg(
    [
      "-f", "lavfi", "-i", "sine=frequency=1400:duration=0.09:sample_rate=48000",
      "-af", "afade=t=out:st=0.005:d=0.085,volume=0.5",
      "-c:a", "pcm_s16le", file,
    ],
    "tick generation",
  );
}

function makeBed(plan: VideoPlan, file: string, config: AudioConfig): void {
  const duration = plan.durationMs / 1000;
  const fadeIn = Math.min(duration / 4, config.fadeInMs / 1000);
  const fadeOut = Math.min(duration / 3, config.fadeOutMs / 1000);
  const outAt = Math.max(0, duration - fadeOut);
  const d = duration.toFixed(3);
  const pad = "0.11*sin(2*PI*110*t)+0.08*sin(2*PI*164.81*t)+0.06*sin(2*PI*220*t)+0.04*sin(2*PI*329.63*t)";
  const pulse = "0.1*sin(2*PI*55*t)*exp(-7*(t-2*floor(t/2)))";

  ffmpeg(
    [
      "-f", "lavfi", "-i", `aevalsrc=${pad}:s=48000:d=${d}`,
      "-f", "lavfi", "-i", `anoisesrc=color=pink:amplitude=0.02:d=${d}:r=48000`,
      "-f", "lavfi", "-i", `aevalsrc=${pulse}:s=48000:d=${d}`,
      "-filter_complex",
      `[0:a]lowpass=f=2400,tremolo=f=0.1:d=0.18,volume=0.8[pad];` +
        `[1:a]lowpass=f=900,volume=0.5[noise];` +
        `[2:a]volume=0.5[pulse];` +
        `[pad][noise][pulse]amix=inputs=3:duration=longest:normalize=0,` +
        `highpass=f=45,afade=t=in:st=0:d=${fadeIn.toFixed(3)},` +
        `afade=t=out:st=${outAt.toFixed(3)}:d=${fadeOut.toFixed(3)}[out]`,
      "-map", "[out]", "-c:a", "pcm_s16le", file,
    ],
    "ambient bed generation",
  );
}

function makeSfxTrack(
  events: SfxEvent[],
  whooshFile: string,
  tickFile: string,
  file: string,
): void {
  if (events.length === 0) return;
  const args: string[] = [];
  const filters: string[] = [];
  const mixInputs: string[] = [];

  for (const [index, event] of events.entries()) {
    args.push("-i", event.kind === "whoosh" ? whooshFile : tickFile);
    const gain = event.kind === "whoosh" ? 0.7 : 0.8;
    filters.push(
      `[${index}:a]aformat=channel_layouts=stereo,adelay=${Math.round(event.atMs)}|${Math.round(event.atMs)},volume=${gain}[s${index}]`,
    );
    mixInputs.push(`[s${index}]`);
  }

  filters.push(`${mixInputs.join("")}amix=inputs=${events.length}:normalize=0[out]`);
  ffmpeg(
    [...args, "-filter_complex", filters.join(";"), "-map", "[out]", "-c:a", "pcm_s16le", file],
    "SFX mix",
  );
}

export interface AudioResult {
  output: string;
  bed: string;
  sfx?: string;
  events: SfxEvent[];
  config: AudioConfig;
}

export interface AttachAudioOptions {
  runId: string;
  plan: VideoPlan;
  silentVideo: string;
  outputVideo: string;
  suffix?: string;
  config?: AudioConfig;
}

export function attachAudio(options: AttachAudioOptions): AudioResult {
  const config = options.config ?? loadAudioConfig();
  if (!config.enabled) {
    throw new Error("Audio is disabled in config/audio.json");
  }

  const dir = ensureDir(path.join(runDir(options.runId), "audio"));
  const suffix = options.suffix ? `${options.suffix}-` : "";
  const bed = path.join(dir, `${suffix}bed.wav`);
  const whoosh = path.join(dir, "whoosh.wav");
  const tick = path.join(dir, "tick.wav");
  const sfx = path.join(dir, `${suffix}sfx.wav`);

  makeBed(options.plan, bed, config);
  const events = buildSfxEvents(options.plan, config);
  let sfxPath: string | undefined;

  if (events.length > 0) {
    if (!fs.existsSync(whoosh)) makeWhoosh(whoosh);
    if (!fs.existsSync(tick)) makeTick(tick);
    makeSfxTrack(events, whoosh, tick, sfx);
    sfxPath = sfx;
  }

  const target = options.outputVideo;
  if (sfxPath) {
    ffmpeg(
      [
        "-i", options.silentVideo,
        "-i", bed,
        "-i", sfxPath,
        "-filter_complex",
        `[1:a]volume=${config.bedLevel}[bed];[2:a]volume=${config.sfxLevel}[sfx];` +
          `[bed][sfx]amix=inputs=2:duration=first:normalize=0,` +
          `loudnorm=I=${config.targetLufs}:TP=${config.truePeakDb}:LRA=${config.loudnessRange}[a]`,
        "-map", "0:v:0", "-map", "[a]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        "-shortest", "-movflags", "+faststart", target,
      ],
      "final audio mix",
    );
  } else {
    ffmpeg(
      [
        "-i", options.silentVideo,
        "-i", bed,
        "-filter_complex",
        `[1:a]volume=${config.bedLevel},loudnorm=I=${config.targetLufs}:TP=${config.truePeakDb}:LRA=${config.loudnessRange}[a]`,
        "-map", "0:v:0", "-map", "[a]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        "-shortest", "-movflags", "+faststart", target,
      ],
      "final audio mix",
    );
  }

  log.info(`Audio: ${events.length} SFX event(s) · ${path.relative(process.cwd(), target)}`);
  return { output: target, bed, ...(sfxPath ? { sfx: sfxPath } : {}), events, config };
}

import fs from "node:fs";
import { spawnSync } from "node:child_process";
import type { QAIssue, VideoPlan } from "../plans/schema.js";

export interface MediaFacts {
  width?: number;
  height?: number;
  fps?: number;
  duration?: number;
  frames?: number;
  pixFmt?: string;
  hasAudio?: boolean;
  audioLufs?: number;
  audioPeak?: number;
}

export interface MediaAuditResult {
  issues: QAIssue[];
  facts: MediaFacts;
}

function run(bin: string, args: string[]) {
  return spawnSync(bin, args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

function parseRate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const [num, den] = value.split("/").map(Number);
  if (!num || !den) return undefined;
  return num / den;
}

export function auditMedia(videoPath: string, plan: VideoPlan): MediaAuditResult {
  const issues: QAIssue[] = [];
  const facts: MediaFacts = {};

  if (!fs.existsSync(videoPath)) {
    return {
      facts,
      issues: [
        {
          id: "media-missing",
          critic: "media",
          severity: "blocker",
          atMs: 0,
          code: "media_missing",
          message: `Video not found: ${videoPath}`,
        },
      ],
    };
  }

  const probe = run("ffprobe", [
    "-v",
    "error",
    "-show_streams",
    "-show_format",
    "-of",
    "json",
    videoPath,
  ]);

  if (probe.status !== 0) {
    issues.push({
      id: "media-probe-failed",
      critic: "media",
      severity: "blocker",
      atMs: 0,
      code: "media_probe_failed",
      message: `ffprobe failed: ${(probe.stderr ?? "").slice(-500)}`,
    });
    return { issues, facts };
  }

  try {
    const data = JSON.parse(probe.stdout) as {
      streams?: Array<{
        codec_type?: string;
        width?: number;
        height?: number;
        r_frame_rate?: string;
        avg_frame_rate?: string;
        nb_frames?: string;
        duration?: string;
        pix_fmt?: string;
      }>;
      format?: { duration?: string };
    };
    const video = data.streams?.find((stream) => stream.codec_type === "video");
    const audio = data.streams?.find((stream) => stream.codec_type === "audio");
    facts.hasAudio = Boolean(audio);
    if (video) {
      facts.width = video.width;
      facts.height = video.height;
      facts.fps = parseRate(video.r_frame_rate) ?? parseRate(video.avg_frame_rate);
      facts.duration = Number(video.duration ?? data.format?.duration);
      facts.frames = video.nb_frames ? Number(video.nb_frames) : undefined;
      facts.pixFmt = video.pix_fmt;
    }
  } catch (error) {
    issues.push({
      id: "media-probe-parse",
      critic: "media",
      severity: "major",
      atMs: 0,
      code: "media_probe_parse",
      message: `Could not parse ffprobe output: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { issues, facts };
  }

  const expectedDuration = plan.durationMs / 1000;
  if (facts.width !== plan.width || facts.height !== plan.height) {
    issues.push({
      id: "media-size",
      critic: "media",
      severity: "blocker",
      atMs: 0,
      code: "media_size",
      message: `Expected ${plan.width}x${plan.height}, received ${facts.width}x${facts.height}`,
      evidence: { metric: facts.width },
    });
  }
  if (facts.fps === undefined || Math.abs(facts.fps - plan.fps) > 0.01) {
    issues.push({
      id: "media-fps",
      critic: "media",
      severity: "major",
      atMs: 0,
      code: "media_fps",
      message: `Expected ${plan.fps}fps, received ${facts.fps ?? "unknown"}`,
      evidence: { metric: facts.fps },
    });
  }
  if (facts.duration === undefined || Math.abs(facts.duration - expectedDuration) > 0.25) {
    issues.push({
      id: "media-duration",
      critic: "media",
      severity: "major",
      atMs: 0,
      code: "media_duration",
      message: `Expected ${expectedDuration.toFixed(2)}s, received ${facts.duration?.toFixed(2) ?? "unknown"}s`,
      evidence: { metric: facts.duration },
    });
  }
  const expectedFrames = Math.round(expectedDuration * plan.fps);
  if (facts.frames !== undefined && Math.abs(facts.frames - expectedFrames) > 3) {
    issues.push({
      id: "media-frames",
      critic: "media",
      severity: "major",
      atMs: 0,
      code: "media_frames",
      message: `Expected about ${expectedFrames} frames, received ${facts.frames}`,
      evidence: { metric: facts.frames },
    });
  }

  if (facts.hasAudio) {
    const audio = run("ffmpeg", [
      "-v",
      "info",
      "-i",
      videoPath,
      "-af",
      "ebur128=peak=true",
      "-f",
      "null",
      "-",
    ]);
    const text = `${audio.stderr ?? ""}\n${audio.stdout ?? ""}`;
    const lufs = [...text.matchAll(/I:\s+(-?\d+(?:\.\d+)?)\s+LUFS/g)].pop();
    const peak = [...text.matchAll(/Peak:\s+(-?\d+(?:\.\d+)?)\s+dBFS/g)].pop();
    if (lufs) facts.audioLufs = Number(lufs[1]);
    if (peak) facts.audioPeak = Number(peak[1]);

    if (facts.audioLufs !== undefined && (facts.audioLufs < -20 || facts.audioLufs > -12)) {
      issues.push({
        id: "media-loudness",
        critic: "media",
        severity: "major",
        atMs: 0,
        code: "media_loudness",
        message: `Integrated loudness ${facts.audioLufs.toFixed(1)} LUFS is outside the -20..-12 window`,
        evidence: { metric: facts.audioLufs },
      });
    }
    if (facts.audioPeak !== undefined && facts.audioPeak > -1) {
      issues.push({
        id: "media-peak",
        critic: "media",
        severity: "major",
        atMs: 0,
        code: "media_peak",
        message: `True peak ${facts.audioPeak.toFixed(1)} dBFS is too close to full scale`,
        evidence: { metric: facts.audioPeak },
      });
    }
    if (facts.audioLufs === undefined) {
      issues.push({
        id: "media-loudness-unknown",
        critic: "media",
        severity: "minor",
        atMs: 0,
        code: "media_loudness_unknown",
        message: "Audio stream exists but integrated loudness could not be measured",
      });
    }
  }

  const black = run("ffmpeg", [
    "-v",
    "info",
    "-i",
    videoPath,
    "-vf",
    "blackdetect=d=0.1:pix_th=0.10",
    "-an",
    "-f",
    "null",
    "-",
  ]);
  const blackText = black.stderr ?? "";
  for (const line of blackText.split(/\r?\n/)) {
    const start = line.match(/black_start:([\d.]+)/);
    const end = line.match(/black_end:([\d.]+)/);
    const duration = line.match(/black_duration:([\d.]+)/);
    if (!start || !end || !duration) continue;
    const startSec = Number(start[1]);
    const endSec = Number(end[1]);
    const durationSec = Number(duration[1]);
    // The opening fade-in is intentional; ignore a short black lead-in.
    if (startSec < 0.05 && endSec < 0.9) continue;
    if (durationSec < 0.2) continue;
    issues.push({
      id: `media-black-${issues.length + 1}`,
      critic: "media",
      severity: "major",
      atMs: Math.round(startSec * 1000),
      code: "media_black_frames",
      message: `Black frames from ${startSec.toFixed(2)}s to ${endSec.toFixed(2)}s`,
      evidence: { metric: durationSec },
    });
  }

  return { issues, facts };
}

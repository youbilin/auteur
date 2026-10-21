import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ensureDir } from "../core/paths.js";

export interface TtsOptions {
  voice?: string;
  rate?: number;
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Local voiceover via Windows SAPI. No network, no API key.
 * macOS/Linux TTS is intentionally not faked; the caller gets a clear error.
 */
export function synthesizeVoice(text: string, outFile: string, options: TtsOptions = {}): string {
  if (process.platform !== "win32") {
    throw new Error("Local TTS is currently implemented for Windows SAPI only.");
  }
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) throw new Error("Voiceover text is empty.");
  if (clean.length > 1200) throw new Error("Voiceover text is too long for a 8–15s film (max 1200 chars).");

  const dir = ensureDir(path.dirname(outFile));
  const textFile = path.join(dir, "voice.txt");
  const scriptFile = path.join(dir, "voice.ps1");
  fs.writeFileSync(textFile, `\uFEFF${clean}`, "utf8");

  const selectVoice = options.voice
    ? `try { $s.SelectVoice(${psQuote(options.voice)}) } catch { }\n`
    : "";
  const rate = Math.max(-10, Math.min(10, Math.round(options.rate ?? 0)));

  const script = [
    "Add-Type -AssemblyName System.Speech",
    `$text = Get-Content -Raw -Encoding UTF8 -LiteralPath ${psQuote(textFile)}`,
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    `$s.Rate = ${rate}`,
    "$s.Volume = 100",
    selectVoice.trim(),
    `$s.SetOutputToWaveFile(${psQuote(outFile)})`,
    "$s.Speak($text)",
    "$s.Dispose()",
    "",
  ]
    .filter(Boolean)
    .join("\n");
  // Windows PowerShell 5.1 reads .ps1 as ANSI unless a UTF-8 BOM is present.
  // The project path contains CJK characters, so this matters.
  fs.writeFileSync(scriptFile, `\uFEFF${script}`, "utf8");

  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptFile],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Windows SAPI TTS failed: ${(result.stderr ?? result.stdout ?? "").slice(-1000)}`);
  }
  if (!fs.existsSync(outFile) || fs.statSync(outFile).size < 1000) {
    throw new Error("TTS did not produce a usable WAV file.");
  }
  return outFile;
}

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";
import { loadEnvLocal } from "../src/core/env.js";
import { log } from "../src/core/log.js";
import {
  PROJECT_ROOT,
  ensureDir,
  readJson,
  runDir,
  slugify,
  timestampId,
} from "../src/core/paths.js";
import {
  addVoiceover,
  ensureRun,
  makeVideo,
  planFromBrief,
  readRunPlan,
  renderRun,
  reviewVideo,
  runFix,
  validateQuality,
  videoPath,
} from "../src/pipeline/run.js";
import { writeComposition } from "../src/compose/html.js";
import {
  buildRegistry,
  loadCapabilities,
  loadModelsConfig,
  resolveModels,
} from "../src/models/registry.js";
import { normalizePlan } from "../src/plans/validate.js";

const DIST_DIR = path.join(PROJECT_ROOT, "studio", "dist");

type Json = Record<string, unknown>;

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(text);
}

function sendText(res: http.ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8"): void {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<Json> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > 4 * 1024 * 1024) {
        reject(new Error("Request body is too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? (JSON.parse(raw) as Json) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function mime(file: string): string {
  switch (path.extname(file).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".woff2": return "font/woff2";
    case ".mp4": return "video/mp4";
    case ".md": return "text/markdown; charset=utf-8";
    default: return "application/octet-stream";
  }
}

function synthesizeBrief(plan: {
  brand?: { name?: string; tagline?: string; look?: string; accent?: string; url?: string };
  ratio?: string;
  scenes?: Array<{
    layout?: string;
    durationMs?: number;
    copy?: { headline?: string; sub?: string };
    callouts?: Array<{ title?: string; body?: string }>;
    screen?: { blocks?: Array<{ kind?: string }> };
  }>;
}): string {
  const brand = plan.brand ?? {};
  const lines = [
    `# ${brand.name ?? "Untitled"}`,
    "",
    brand.tagline ?? "",
    "",
    `Format: ${plan.ratio ?? "16:9"} · look: ${brand.look ?? "dusk"} · accent: ${brand.accent ?? "#8BD3FF"}`,
    "",
    "Derived from the current plan. Edit and regenerate when you want a new take.",
    "",
  ];
  plan.scenes?.forEach((scene, index) => {
    lines.push(`## Scene ${index + 1} — ${scene.layout ?? "device"} · ${((scene.durationMs ?? 0) / 1000).toFixed(1)}s`);
    lines.push("");
    lines.push(scene.copy?.headline ?? "");
    if (scene.copy?.sub) lines.push("", scene.copy.sub);
    if (scene.callouts?.length) {
      lines.push("", `Callout: ${scene.callouts[0]?.title ?? ""} — ${scene.callouts[0]?.body ?? ""}`);
    }
    lines.push("");
  });
  return `${lines.join("\n")}\n`;
}

function safeFile(res: http.ServerResponse, file: string, cache = false): void {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    sendJson(res, 404, { ok: false, error: "Not found" });
    return;
  }
  res.writeHead(200, {
    "Content-Type": mime(file),
    "Cache-Control": cache ? "public, max-age=60" : "no-store",
  });
  fs.createReadStream(file).pipe(res);
}

function sendVideo(req: http.IncomingMessage, res: http.ServerResponse, file: string): void {
  if (!fs.existsSync(file)) {
    sendJson(res, 404, { ok: false, error: "Video not found" });
    return;
  }
  const stat = fs.statSync(file);
  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, {
      "Content-Type": "video/mp4",
      "Content-Length": stat.size,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    });
    fs.createReadStream(file).pipe(res);
    return;
  }
  const match = /bytes=(\d+)-(\d*)/.exec(range);
  if (!match) {
    res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
    res.end();
    return;
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : Math.min(start + 1024 * 1024, stat.size - 1);
  res.writeHead(206, {
    "Content-Type": "video/mp4",
    "Content-Range": `bytes ${start}-${end}/${stat.size}`,
    "Accept-Ranges": "bytes",
    "Content-Length": end - start + 1,
    "Cache-Control": "no-store",
  });
  fs.createReadStream(file, { start, end }).pipe(res);
}

function summarizeRun(runId: string): Json | null {
  const dir = runDir(runId);
  const planFile = path.join(dir, "plan.json");
  if (!fs.existsSync(planFile)) return null;
  const plan = readJson<{
    scenes?: unknown[];
    durationMs?: number;
    width?: number;
    height?: number;
    ratio?: string;
    brand?: { name?: string; look?: string };
  }>(planFile);
  const qaFile = path.join(dir, "qa.json");
  const qa = fs.existsSync(qaFile)
    ? readJson<{ score?: number; verdict?: string; issues?: unknown[]; rubric?: Json }>(qaFile)
    : undefined;
  const video = videoPath(runId);
  const fixedVideo = videoPath(runId, true);
  const contact = path.join(dir, "frames", "contact-sheet.jpg");
  const meta = fs.existsSync(path.join(dir, "meta.json"))
    ? readJson<Json>(path.join(dir, "meta.json"))
    : {};
  const videoMtime = fs.existsSync(video) ? fs.statSync(video).mtimeMs : 0;
  return {
    id: runId,
    brand: plan.brand?.name ?? runId,
    look: plan.brand?.look ?? "",
    ratio: plan.ratio ?? "",
    scenes: plan.scenes?.length ?? 0,
    durationMs: plan.durationMs ?? 0,
    width: plan.width ?? 0,
    height: plan.height ?? 0,
    hasPlan: true,
    hasVideo: fs.existsSync(video),
    hasFixed: fs.existsSync(fixedVideo),
    hasQa: Boolean(qa),
    score: qa?.score,
    verdict: qa?.verdict,
    issues: qa?.issues?.length,
    hasVoice: fs.existsSync(path.join(dir, "voice.wav")),
    layout: plan.scenes?.[0] ? (plan.scenes[0] as { layout?: string }).layout ?? "device" : "device",
    createdAt: meta.createdAt ?? fs.statSync(planFile).mtime.toISOString(),
    videoUpdatedAt: videoMtime,
    videoUrl: `/api/runs/${encodeURIComponent(runId)}/video`,
    fixedVideoUrl: `/api/runs/${encodeURIComponent(runId)}/video?fixed=1`,
    contactUrl: fs.existsSync(contact)
      ? `/api/runs/${encodeURIComponent(runId)}/contact`
      : undefined,
    planUrl: `/api/runs/${encodeURIComponent(runId)}/plan`,
    qaUrl: fs.existsSync(qaFile) ? `/api/runs/${encodeURIComponent(runId)}/qa` : undefined,
    qaMarkdownUrl: fs.existsSync(path.join(dir, "qa.md"))
      ? `/api/runs/${encodeURIComponent(runId)}/qa.md`
      : undefined,
  };
}

function listRuns(): Json[] {
  const root = path.join(PROJECT_ROOT, "runs");
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => summarizeRun(entry.name))
    .filter((entry): entry is Json => Boolean(entry))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function modelStatus(): Json {
  try {
    const config = loadModelsConfig(PROJECT_ROOT);
    const capabilities = loadCapabilities(PROJECT_ROOT);
    const models = resolveModels(config, capabilities);
    return {
      ok: true,
      models: models.map((model) => ({
        id: model.id,
        model: model.modelName,
        json: model.supports.json,
        images: model.supports.images,
      })),
      roles: config.roles,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function runsFile(runId: string, name: string): string {
  return path.join(runDir(runId), name);
}

function routeApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
  const parts = url.pathname.split("/").filter(Boolean);
  // /api/<...>
  const tail = parts.slice(1);

  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === "GET" && tail[0] === "status") {
    sendJson(res, 200, modelStatus());
    return;
  }

  if (req.method === "GET" && tail[0] === "briefs") {
    const dir = path.join(PROJECT_ROOT, "briefs");
    const briefs = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((file) => file.endsWith(".md")).map((file) => ({
          id: file.replace(/\.md$/, ""),
          title: file.replace(/\.md$/, "").replace(/[-_]/g, " "),
          content: fs.readFileSync(path.join(dir, file), "utf8"),
        }))
      : [];
    sendJson(res, 200, { ok: true, briefs });
    return;
  }

  if (req.method === "GET" && tail[0] === "runs" && tail.length === 1) {
    sendJson(res, 200, { ok: true, runs: listRuns() });
    return;
  }

  if (tail[0] === "runs" && tail[1]) {
    const runId = slugify(tail[1]);
    const dir = runDir(runId);
    if (tail[2] === "video") {
      sendVideo(req, res, url.searchParams.get("fixed") === "1" ? videoPath(runId, true) : videoPath(runId));
      return;
    }
    if (tail[2] === "contact") {
      safeFile(res, path.join(dir, "frames", "contact-sheet.jpg"), true);
      return;
    }
    if (tail[2] === "plan") {
      safeFile(res, runsFile(runId, "plan.json"));
      return;
    }
    if (tail[2] === "qa") {
      safeFile(res, runsFile(runId, "qa.json"));
      return;
    }
    if (tail[2] === "qa.md") {
      safeFile(res, runsFile(runId, "qa.md"));
      return;
    }
    if (req.method === "GET" && tail.length === 2) {
      const summary = summarizeRun(runId);
      if (!summary) {
        sendJson(res, 404, { ok: false, error: "Run not found" });
        return;
      }
      const plan = fs.existsSync(runsFile(runId, "plan.json"))
        ? readJson(runsFile(runId, "plan.json"))
        : null;
      const qa = fs.existsSync(runsFile(runId, "qa.json"))
        ? readJson(runsFile(runId, "qa.json"))
        : null;
      let brief = fs.existsSync(runsFile(runId, "brief.md"))
        ? fs.readFileSync(runsFile(runId, "brief.md"), "utf8")
        : "";
      if (!brief.trim() && plan) {
        brief = synthesizeBrief(plan as Parameters<typeof synthesizeBrief>[0]);
        fs.writeFileSync(runsFile(runId, "brief.md"), brief, "utf8");
      }
      const voiceText = fs.existsSync(runsFile(runId, "voice.txt"))
        ? fs.readFileSync(runsFile(runId, "voice.txt"), "utf8")
        : "";
      sendJson(res, 200, { ok: true, run: summary, plan, qa, brief, voiceText });
      return;
    }
  }

  if (req.method !== "POST") {
    sendJson(res, 404, { ok: false, error: "Not found" });
    return;
  }

  readBody(req)
    .then(async (body) => {
      const action = tail[0];
      if (action === "plan" && tail[1] === "save") {
        const runId = slugify(String(body.runId ?? ""));
        if (!runId) throw new Error("runId is required");
        const plan = normalizePlan(body.plan, { id: runId });
        writeComposition(runId, plan);
        fs.writeFileSync(runsFile(runId, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
        sendJson(res, 200, { ok: true, plan, run: summarizeRun(runId) });
        return;
      }

      if (action === "plan") {
        const brief = String(body.brief ?? "");
        if (!brief.trim()) throw new Error("Brief is required");
        const runId = slugify(String(body.runId ?? timestampId("plan")));
        ensureRun(runId);
        const result = await planFromBrief({
          brief,
          runId,
          ratio: body.ratio === "9:16" ? "9:16" : "16:9",
          layout: String(body.layout ?? "auto"),
        });
        sendJson(res, 200, { ok: true, run: summarizeRun(result.runId), plan: result.plan });
        return;
      }

      const runId = slugify(String(body.runId ?? ""));
      if (!runId) throw new Error("runId is required");

      if (action === "render") {
        const plan = readRunPlan(runId);
        const output = renderRun(runId, plan, {
          quality: validateQuality(String(body.quality ?? "looks")),
          force: Boolean(body.force),
          ...(body.mode === "scenes" ? { sceneMode: true } : {}),
        });
        sendJson(res, 200, { ok: true, video: output, run: summarizeRun(runId) });
        return;
      }

      if (action === "qa") {
        const plan = readRunPlan(runId);
        writeComposition(runId, plan);
        let registry;
        try {
          registry = buildRegistry(PROJECT_ROOT, runDir(runId));
        } catch (error) {
          log.warn(`VLM review skipped: ${error instanceof Error ? error.message : String(error)}`);
        }
        const report = await reviewVideo(runId, plan, videoPath(runId), registry ? { registry } : {});
        sendJson(res, 200, { ok: true, qa: report, run: summarizeRun(runId) });
        return;
      }

      if (action === "fix") {
        const result = await runFix(
          runId,
          readRunPlan(runId),
          validateQuality(String(body.quality ?? "looks")),
          { ...(body.mode === "scenes" ? { sceneMode: true } : {}) },
        );
        sendJson(res, 200, {
          ok: true,
          result,
          run: summarizeRun(runId),
        });
        return;
      }

      if (action === "voice") {
        const text = String(body.text ?? "").trim();
        if (!text) throw new Error("Voiceover text is required");
        const result = addVoiceover(runId, text, {
          ...(body.voice ? { voice: String(body.voice) } : {}),
          ...(body.rate !== undefined ? { rate: Number(body.rate) } : {}),
        });
        sendJson(res, 200, { ok: true, voiceFile: result.voiceFile, run: summarizeRun(runId) });
        return;
      }

      if (action === "make") {
        const brief = String(body.brief ?? "");
        if (!brief.trim()) throw new Error("Brief is required");
        const id = slugify(String(body.runId ?? timestampId("make")));
        const result = await makeVideo({
          brief,
          runId: id,
          ratio: body.ratio === "9:16" ? "9:16" : "16:9",
          quality: validateQuality(String(body.quality ?? "looks")),
          layout: String(body.layout ?? "auto"),
          force: Boolean(body.force),
          ...(body.mode === "scenes" ? { sceneMode: true } : {}),
        });
        sendJson(res, 200, { ok: true, run: summarizeRun(id), qa: result.report, video: result.video });
        return;
      }

      sendJson(res, 404, { ok: false, error: "Unknown action" });
    })
    .catch((error: unknown) => {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    });
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = path.resolve(DIST_DIR, `.${requested}`);
  if (!file.startsWith(DIST_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    safeFile(res, file, true);
    return;
  }
  const index = path.join(DIST_DIR, "index.html");
  if (fs.existsSync(index)) {
    safeFile(res, index);
    return;
  }
  sendText(
    res,
    200,
    "Auteur Studio API is running. Build the UI with `pnpm run studio:build`, or use `pnpm run studio` for the dev server.",
    "text/plain; charset=utf-8",
  );
}

export async function startStudioServer(port = 4310): Promise<http.Server> {
  loadEnvLocal(PROJECT_ROOT);
  ensureDir(path.join(PROJECT_ROOT, "runs"));
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (url.pathname.startsWith("/api/")) {
      routeApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  });
  server.requestTimeout = 900_000;
  server.headersTimeout = 60_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  log.info(`Studio API: http://127.0.0.1:${port}`);
  if (fs.existsSync(path.join(DIST_DIR, "index.html"))) {
    log.info(`Studio: http://127.0.0.1:${port}`);
  }
  return server;
}

// Convenience for `auteur studio`
const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const port = Number(process.env.AUTEUR_STUDIO_PORT ?? 4310);
  await startStudioServer(port);
}

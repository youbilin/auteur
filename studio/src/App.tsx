import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Braces,
  Check,
  Clapperboard,
  Copy,
  Film,
  Loader2,
  Mic,
  Play,
  RefreshCw,
  ShieldCheck,
  Wrench,
  Wand2,
  X,
} from "lucide-react";

type Ratio = "16:9" | "9:16";
type Quality = "draft" | "looks" | "delivery";
type Layout = "auto" | "device" | "data" | "type" | "hook";
type RenderMode = "full" | "scenes";

interface ModelInfo {
  id: string;
  model: string;
  json: string;
  images: string;
}

interface Status {
  ok: boolean;
  error?: string;
  models?: ModelInfo[];
  roles?: Record<string, { chain: string[] }>;
}

interface BriefFile {
  id: string;
  title: string;
  content: string;
}

interface RunSummary {
  id: string;
  brand: string;
  look: string;
  ratio: string;
  scenes: number;
  durationMs: number;
  width: number;
  height: number;
  hasPlan: boolean;
  hasVideo: boolean;
  hasFixed: boolean;
  hasQa: boolean;
  score?: number;
  verdict?: string;
  issues?: number;
  hasVoice: boolean;
  layout: string;
  createdAt: string;
  videoUpdatedAt: number;
  videoUrl: string;
  fixedVideoUrl: string;
  contactUrl?: string;
  planUrl: string;
  qaUrl?: string;
  qaMarkdownUrl?: string;
}

interface Block {
  kind: string;
  [key: string]: unknown;
}

interface Scene {
  id: string;
  layout?: string;
  durationMs: number;
  copy: { headline: string; sub?: string };
  screen?: { appName: string; blocks: Block[] };
  callouts?: Array<{ title: string }>;
  camera?: unknown[];
}

interface Plan {
  id: string;
  ratio: Ratio;
  durationMs: number;
  width: number;
  height: number;
  brand: { name: string; look: string; tagline?: string; accent: string; url?: string };
  scenes: Scene[];
}

interface QAIssue {
  id: string;
  severity: "blocker" | "major" | "minor";
  critic: string;
  code: string;
  message: string;
  atMs: number;
}

interface QA {
  score: number;
  verdict: "pass" | "fix" | "fail";
  rubric: { dom: number; media: number; hyperframes?: number; vlm?: number };
  issues: QAIssue[];
  notes: string[];
}

interface RunDetail {
  run: RunSummary;
  plan: Plan | null;
  qa: QA | null;
  brief: string;
  voiceText: string;
}

interface RunsResponse {
  runs: RunSummary[];
}

interface BriefsResponse {
  briefs: BriefFile[];
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  const data = payload as { ok?: boolean; error?: string };
  if (!response.ok || data.ok === false) {
    throw new Error(data.error ?? `Request failed (${response.status})`);
  }
  return payload as T;
}

function post<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, { method: "POST", body: JSON.stringify(body) });
}

function fmtDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function withVersion(url: string, version: number): string {
  return `${url}${url.includes("?") ? "&" : "?"}v=${version}`;
}

function shorten(value: string, max = 56): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function IssueRow({ issue }: { issue: QAIssue }) {
  return (
    <div className="issue-row">
      <span className={`issue-dot ${issue.severity}`} />
      <div>
        <div className="issue-meta">
          <span className="issue-code">{issue.code}</span>
          <span>{issue.atMs ? fmtDuration(issue.atMs) : "global"}</span>
          <span>{issue.critic}</span>
        </div>
        <div className="issue-message">{issue.message}</div>
      </div>
    </div>
  );
}

function FileRow({
  label,
  path,
  onCopy,
}: {
  label: string;
  path: string;
  onCopy: (value: string) => void;
}) {
  return (
    <div className="file-row">
      <span className="file-label">{label}</span>
      <code title={path}>{shorten(path, 44)}</code>
      <button type="button" className="icon-button" onClick={() => onCopy(path)} aria-label={`Copy ${label} path`}>
        <Copy size={13} />
      </button>
    </div>
  );
}

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [briefs, setBriefs] = useState<BriefFile[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [brief, setBrief] = useState("");
  const [ratio, setRatio] = useState<Ratio>("16:9");
  const [layout, setLayout] = useState<Layout>("auto");
  const [quality, setQuality] = useState<Quality>("looks");
  const [renderMode, setRenderMode] = useState<RenderMode>("full");
  const [voiceText, setVoiceText] = useState("");
  const [jsonDraft, setJsonDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [videoNonce, setVideoNonce] = useState(0);
  const [useFixed, setUseFixed] = useState(false);
  const [videoError, setVideoError] = useState(false);

  const loadRun = useCallback(async (id: string) => {
    const data = await request<RunDetail>(`/api/runs/${encodeURIComponent(id)}`);
    setCurrentId(id);
    setDetail(data);
    setBrief(data.brief ?? "");
    setVoiceText(data.voiceText ?? "");
    setRatio((data.plan?.ratio as Ratio) ?? "16:9");
    const distinctLayouts = [
      ...new Set((data.plan?.scenes ?? []).map((scene) => scene.layout ?? "device")),
    ];
    setLayout(
      distinctLayouts.length === 1 ? ((distinctLayouts[0] as Layout) ?? "auto") : "auto",
    );
    setJsonDraft(data.plan ? JSON.stringify(data.plan, null, 2) : "");
    setUseFixed(false);
    setVideoError(false);
    setVideoNonce((value) => value + 1);
    setError("");
  }, []);

  const refreshRuns = useCallback(async (): Promise<RunSummary[]> => {
    const data = await request<RunsResponse>("/api/runs");
    setRuns(data.runs);
    return data.runs;
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [modelStatus, briefData, runData] = await Promise.all([
          request<Status>("/api/status"),
          request<BriefsResponse>("/api/briefs"),
          request<RunsResponse>("/api/runs"),
        ]);
        if (!mounted) return;
        setStatus(modelStatus);
        setBriefs(briefData.briefs);
        setRuns(runData.runs);
        if (runData.runs[0]) {
          await loadRun(runData.runs[0].id);
        } else {
          setBrief(briefData.briefs[0]?.content ?? "");
        }
      } catch (caught) {
        if (mounted) setError(caught instanceof Error ? caught.message : String(caught));
      }
    })();
    return () => {
      mounted = false;
    };
  }, [loadRun]);

  useEffect(() => {
    if (!startedAt) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  const plan = detail?.plan ?? null;
  const qa = detail?.qa ?? null;
  const currentRun = detail?.run ?? null;
  const scenes = plan?.scenes ?? [];
  const total = plan?.durationMs ?? 0;
  const directorId = status?.roles?.director?.chain?.[0];
  const directorModel =
    status?.models?.find((model) => model.id === directorId) ?? status?.models?.[0];
  const modelsCount = status?.models?.length ?? 0;
  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;

  const videoUrl = useMemo(() => {
    if (!currentRun?.hasVideo) return "";
    const base = useFixed && currentRun.hasFixed ? currentRun.fixedVideoUrl : currentRun.videoUrl;
    return withVersion(base, currentRun.videoUpdatedAt + videoNonce);
  }, [currentRun, useFixed, videoNonce]);

  const runBusy = useCallback(
    async (label: string, action: () => Promise<void>) => {
      setBusy(label);
      setStartedAt(Date.now());
      setNow(Date.now());
      setError("");
      setNotice("");
      try {
        await action();
        setNotice(`${label} complete`);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setBusy(null);
        setStartedAt(null);
      }
    },
    [],
  );

  const generateFilm = () =>
    runBusy("Generating film", async () => {
      if (!brief.trim()) throw new Error("Write a brief first.");
      const data = await post<{ run: RunSummary }>("/api/make", {
        brief,
        ratio,
        layout,
        quality,
        mode: renderMode,
      });
      await refreshRuns();
      await loadRun(data.run.id);
    });

  const planOnly = () =>
    runBusy("Writing plan", async () => {
      if (!brief.trim()) throw new Error("Write a brief first.");
      const data = await post<{ run: RunSummary }>("/api/plan", {
        brief,
        ratio,
        layout,
      });
      await refreshRuns();
      await loadRun(data.run.id);
    });

  const render = () =>
    runBusy("Rendering", async () => {
      if (!currentId) throw new Error("Generate or select a run first.");
      await post("/api/render", { runId: currentId, quality, mode: renderMode });
      await loadRun(currentId);
      await refreshRuns();
    });

  const review = () =>
    runBusy("Running QA", async () => {
      if (!currentId) throw new Error("Generate or select a run first.");
      await post("/api/qa", { runId: currentId });
      await loadRun(currentId);
      await refreshRuns();
    });

  const fix = () =>
    runBusy("Fixing", async () => {
      if (!currentId) throw new Error("Generate or select a run first.");
      await post("/api/fix", { runId: currentId, quality, mode: renderMode });
      await loadRun(currentId);
      await refreshRuns();
    });

  const addVoice = () =>
    runBusy("Generating voiceover", async () => {
      if (!currentId) throw new Error("Generate a video first.");
      if (!voiceText.trim()) throw new Error("Write voiceover text first.");
      await post("/api/voice", { runId: currentId, text: voiceText });
      await loadRun(currentId);
      await refreshRuns();
    });

  const savePlan = () =>
    runBusy("Saving plan", async () => {
      if (!currentId) throw new Error("Select a run first.");
      const parsed = JSON.parse(jsonDraft) as unknown;
      await post("/api/plan/save", { runId: currentId, plan: parsed });
      await loadRun(currentId);
      await refreshRuns();
    });

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("Path copied");
    } catch {
      setError("Clipboard is unavailable in this browser.");
    }
  };

  const importBrief = (id: string) => {
    const file = briefs.find((item) => item.id === id);
    if (file) setBrief(file.content);
  };

  const videoLabel = useFixed && currentRun?.hasFixed ? "fixed" : "original";

  return (
    <div className="app">
      <header className="topbar">
        <div className="wordmark">
          <Clapperboard size={16} />
          <strong>Auteur</strong>
          <span>Studio</span>
        </div>
        <div className="run-switcher">
          <select
            value={currentId ?? ""}
            onChange={(event) => {
              if (event.target.value) void loadRun(event.target.value).catch((caught: unknown) => {
                setError(caught instanceof Error ? caught.message : String(caught));
              });
            }}
            aria-label="Select a run"
          >
            {runs.length === 0 ? <option value="">No runs</option> : null}
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {run.brand} · {run.id}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="icon-button"
            onClick={() => void refreshRuns().catch((caught: unknown) => {
              setError(caught instanceof Error ? caught.message : String(caught));
            })}
            aria-label="Refresh runs"
            title="Refresh runs"
          >
            <RefreshCw size={13} />
          </button>
        </div>
        <div className="top-status" title={status?.error ?? "Local relay"}>
          <span className={`status-dot ${status?.ok && modelsCount > 0 ? "ok" : "bad"}`} />
          <span>{status?.ok ? `${modelsCount} models` : "Relay unavailable"}</span>
          <span className="top-muted">{directorModel ? shorten(directorModel.model, 34) : "no model"}</span>
        </div>
        <div className="top-meta">Local · no cloud</div>
      </header>

      {busy ? (
        <div className="progress-line" role="status">
          <span />
        </div>
      ) : null}

      {error ? (
        <div className="banner error" role="alert">
          <AlertTriangle size={14} />
          <span>{error}</span>
          <button type="button" className="icon-button" onClick={() => setError("")} aria-label="Dismiss error">
            <X size={13} />
          </button>
        </div>
      ) : null}

      {notice ? (
        <div className="banner notice" role="status">
          <Check size={14} />
          <span>{notice}</span>
          <button type="button" className="icon-button" onClick={() => setNotice("")} aria-label="Dismiss message">
            <X size={13} />
          </button>
        </div>
      ) : null}

      <main className="workspace">
        <aside className="left">
          <div className="section-head">
            <span>Brief</span>
            <span className="section-hint">⌘↵ generate</span>
          </div>
          <textarea
            className="brief-input"
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void generateFilm();
              }
            }}
            placeholder="Describe the product, audience, tone, look, and three scenes."
            aria-label="Product brief"
          />
          <div className="preset-row">
            <select
              value=""
              onChange={(event) => importBrief(event.target.value)}
              aria-label="Load a brief preset"
            >
              <option value="">Load brief preset…</option>
              {briefs.map((file) => (
                <option key={file.id} value={file.id}>
                  {file.title}
                </option>
              ))}
            </select>
          </div>

          <div className="field-grid">
            <label>
              <span className="field-label">Ratio</span>
              <div className="segmented" role="group" aria-label="Aspect ratio">
                {(["16:9", "9:16"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={ratio === value ? "active" : ""}
                    onClick={() => setRatio(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </label>
            <label>
              <span className="field-label">Layout</span>
              <select value={layout} onChange={(event) => setLayout(event.target.value as Layout)}>
                <option value="auto">Auto</option>
                <option value="device">Device</option>
                <option value="data">Data</option>
                <option value="type">Type</option>
                <option value="hook">Hook</option>
              </select>
            </label>
            <label>
              <span className="field-label">Quality</span>
              <select value={quality} onChange={(event) => setQuality(event.target.value as Quality)}>
                <option value="draft">Draft</option>
                <option value="looks">Looks</option>
                <option value="delivery">Delivery</option>
              </select>
            </label>
            <label>
              <span className="field-label">Render mode</span>
              <select value={renderMode} onChange={(event) => setRenderMode(event.target.value as RenderMode)}>
                <option value="full">Full</option>
                <option value="scenes">Scenes</option>
              </select>
            </label>
          </div>

          <div className="primary-actions">
            <button type="button" className="button primary" onClick={() => void generateFilm()} disabled={Boolean(busy)}>
              {busy === "Generating film" ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />}
              {busy === "Generating film" ? `Working ${elapsed}s` : "Generate film"}
            </button>
            <button type="button" className="button ghost" onClick={() => void planOnly()} disabled={Boolean(busy)}>
              <Braces size={14} />
              Plan only
            </button>
          </div>
          <p className="hint">The model writes a typed plan. The template owns layout, type, motion, and audio.</p>

          <div className="rule" />

          <div className="section-head">
            <span>Voiceover</span>
            <span className="section-hint">SAPI · local</span>
          </div>
          <textarea
            className="voice-input"
            value={voiceText}
            onChange={(event) => setVoiceText(event.target.value)}
            placeholder="One or two sentences. Optional."
            aria-label="Voiceover text"
          />
          <button type="button" className="button ghost wide" onClick={() => void addVoice()} disabled={Boolean(busy) || !currentRun?.hasVideo}>
            {busy === "Generating voiceover" ? <Loader2 size={14} className="spin" /> : <Mic size={14} />}
            {currentRun?.hasVoice ? "Regenerate voiceover" : "Generate voiceover"}
          </button>

          <div className="rule" />

          <div className="section-head">
            <span>Engine</span>
            <span className="section-hint">local</span>
          </div>
          <div className="engine-line">
            <span className={`status-dot ${status?.ok && modelsCount > 0 ? "ok" : "bad"}`} />
            <span>{status?.ok ? `${modelsCount} models available` : status?.error ?? "Relay unavailable"}</span>
          </div>
          <div className="engine-line muted">
            <span>Director</span>
            <code>{directorModel?.id ?? "unassigned"}</code>
          </div>
          <div className="engine-line muted">
            <span>Vision</span>
            <code>{status?.models?.find((model) => model.images === "yes")?.id ?? "deterministic only"}</code>
          </div>
          <p className="hint">Keys stay in `.env.local`. The Studio server binds to 127.0.0.1.</p>
        </aside>

        <section className="center">
          <div className="center-head">
            <div>
              <div className="eyebrow">Plan</div>
              <h1>{plan?.brand?.name ?? "No plan yet"}</h1>
            </div>
            <div className="center-meta">
              {plan ? `${scenes.length} scenes · ${fmtDuration(total)} · ${plan.ratio}` : "waiting for a brief"}
            </div>
          </div>

          {plan ? (
            <div className="scene-list">
              {scenes.map((scene, index) => (
                <article className="scene-row" key={scene.id}>
                  <div className="scene-index">{String(index + 1).padStart(2, "0")}</div>
                  <div className="scene-main">
                    <div className="scene-top">
                      <span className="tag">{scene.layout ?? "device"}</span>
                      <span className="scene-duration">{fmtDuration(scene.durationMs)}</span>
                    </div>
                    <div className="scene-headline">{scene.copy.headline}</div>
                    {scene.copy.sub ? <div className="scene-sub">{scene.copy.sub}</div> : null}
                    <div className="scene-tags">
                      {(scene.screen?.blocks ?? []).map((block, blockIndex) => (
                        <span key={`${block.kind}-${blockIndex}`}>{block.kind}</span>
                      ))}
                      {(scene.callouts?.length ?? 0) > 0 ? <span>{scene.callouts?.length} callout</span> : null}
                    </div>
                    <div className="scene-bar">
                      <span style={{ width: `${Math.max(2, (scene.durationMs / total) * 100)}%` }} />
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-center">
              <Film size={22} />
              <strong>No plan yet</strong>
              <span>Write a brief on the left, then generate a plan or the whole film.</span>
              <button type="button" className="button ghost" onClick={() => void planOnly()} disabled={Boolean(busy)}>
                <Braces size={14} />
                Generate plan
              </button>
            </div>
          )}

          {runs.length > 1 ? (
            <div className="runs-block">
              <div className="section-head">
                <span>Recent runs</span>
                <span className="section-hint">{runs.length}</span>
              </div>
              <div className="runs-table">
                {runs.slice(0, 8).map((run) => (
                  <button
                    type="button"
                    className={`run-line ${run.id === currentId ? "active" : ""}`}
                    key={run.id}
                    onClick={() => {
                      void loadRun(run.id).catch((caught: unknown) => {
                        setError(caught instanceof Error ? caught.message : String(caught));
                      });
                    }}
                  >
                    <span className="run-name">{run.brand}<em>{run.id}</em></span>
                    <span>{run.ratio}</span>
                    <span>{run.scenes} scenes</span>
                    <span className={`run-score ${run.verdict ?? "none"}`}>{run.score ?? "—"}</span>
                    <span className="run-time">{new Date(run.createdAt).toLocaleDateString()}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {plan ? (
            <details className="json-editor">
              <summary>
                <span>Edit plan JSON</span>
                <span className="section-hint">advanced</span>
              </summary>
              <textarea
                value={jsonDraft}
                onChange={(event) => setJsonDraft(event.target.value)}
                spellCheck={false}
                aria-label="Plan JSON"
              />
              <div className="json-actions">
                <span className="hint">Saving recompiles the composition; render to see changes.</span>
                <button type="button" className="button ghost" onClick={() => void savePlan()} disabled={Boolean(busy)}>
                  {busy === "Saving plan" ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
                  Save plan
                </button>
              </div>
            </details>
          ) : null}
        </section>

        <aside className="right">
          <div className="preview-head">
            <div className="eyebrow">Preview</div>
            <div className="preview-tools">
              {currentRun?.hasFixed ? (
                <div className="segmented small">
                  <button type="button" className={!useFixed ? "active" : ""} onClick={() => setUseFixed(false)}>
                    Original
                  </button>
                  <button type="button" className={useFixed ? "active" : ""} onClick={() => setUseFixed(true)}>
                    Fixed
                  </button>
                </div>
              ) : null}
              <span className="preview-label">{videoLabel}</span>
            </div>
          </div>

          <div className={`video-frame ${plan?.ratio === "9:16" ? "vertical" : ""}`}>
            {videoUrl ? (
              <video
                key={videoUrl}
                src={videoUrl}
                poster={currentRun?.contactUrl}
                controls
                playsInline
                onError={() => setVideoError(true)}
              />
            ) : (
              <div className="empty-video">
                <Play size={20} />
                <span>{currentRun?.hasPlan ? "Render to preview" : "Generate a plan first"}</span>
              </div>
            )}
            {videoError ? <div className="video-error">Video could not load. Check the render log.</div> : null}
          </div>

          <div className="qa-block">
            <div className="qa-head">
              <div className="eyebrow">QA</div>
              {qa ? <span className={`verdict ${qa.verdict}`}>{qa.verdict}</span> : <span className="verdict none">not run</span>}
              {qa ? <span className="issue-count">{qa.issues.length} issues</span> : null}
              <span className="qa-score">{qa ? qa.score : "—"}</span>
            </div>
            {qa ? (
              <>
                <div className="rubric-row">
                  <span>DOM {qa.rubric.dom}</span>
                  <span>Media {qa.rubric.media}</span>
                  <span>HF {qa.rubric.hyperframes ?? "—"}</span>
                  <span>VLM {qa.rubric.vlm ?? "—"}</span>
                </div>
                <div className="issue-list">
                  {qa.issues.length === 0 ? (
                    <div className="qa-empty"><Check size={14} /> No issues. Human review still required.</div>
                  ) : (
                    qa.issues.map((issue) => <IssueRow issue={issue} key={issue.id} />)
                  )}
                </div>
              </>
            ) : (
              <div className="qa-empty">
                <ShieldCheck size={14} />
                {currentRun?.hasVideo ? "Run QA to inspect the current film." : "Render a film, then run QA."}
              </div>
            )}
          </div>

          <div className="action-row">
            <button type="button" className="button" onClick={() => void render()} disabled={Boolean(busy) || !currentRun?.hasPlan}>
              {busy === "Rendering" ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
              Render
            </button>
            <button type="button" className="button" onClick={() => void review()} disabled={Boolean(busy) || !currentRun?.hasVideo}>
              {busy === "Running QA" ? <Loader2 size={14} className="spin" /> : <ShieldCheck size={14} />}
              QA
            </button>
            <button type="button" className="button" onClick={() => void fix()} disabled={Boolean(busy) || !currentRun?.hasQa}>
              {busy === "Fixing" ? <Loader2 size={14} className="spin" /> : <Wrench size={14} />}
              Fix
            </button>
          </div>

          <div className="files-block">
            <div className="section-head">
              <span>Files</span>
              <span className="section-hint">{currentId ?? "no run"}</span>
            </div>
            {currentId ? (
              <>
                <FileRow label="video" path={`runs/${currentId}/out/video.mp4`} onCopy={copy} />
                <FileRow label="plan" path={`runs/${currentId}/plan.json`} onCopy={copy} />
                {currentRun?.hasQa ? <FileRow label="qa" path={`runs/${currentId}/qa.md`} onCopy={copy} /> : null}
                {currentRun?.hasVoice ? <FileRow label="voice" path={`runs/${currentId}/voice.wav`} onCopy={copy} /> : null}
                <FileRow label="html" path={`runs/${currentId}/composition/index.html`} onCopy={copy} />
              </>
            ) : (
              <div className="files-empty">No run selected.</div>
            )}
          </div>

          {qa?.notes?.length ? (
            <details className="notes-block">
              <summary>
                <span>Notes</span>
                <span className="section-hint">{qa.notes.length}</span>
              </summary>
              {qa.notes.map((note, index) => (
                <p key={index}>{note}</p>
              ))}
            </details>
          ) : null}
        </aside>
      </main>
    </div>
  );
}

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
import { detectLang, translate, type Lang, type MessageKey } from "./i18n.js";

type Ratio = "16:9" | "9:16";
type Quality = "draft" | "looks" | "delivery";
type Layout = "auto" | "device" | "data" | "type" | "hook";
type RenderMode = "full" | "scenes";
type BusyKey = "generate" | "plan" | "render" | "qa" | "fix" | "voice" | "save";

const busyLabels: Record<BusyKey, MessageKey> = {
  generate: "busy.generate",
  plan: "busy.plan",
  render: "busy.render",
  qa: "busy.qa",
  fix: "busy.fix",
  voice: "busy.voice",
  save: "busy.save",
};

const doneLabels: Record<BusyKey, MessageKey> = {
  generate: "done.generate",
  plan: "done.plan",
  render: "done.render",
  qa: "done.qa",
  fix: "done.fix",
  voice: "done.voice",
  save: "done.save",
};

const verdictLabels: Record<QA["verdict"], MessageKey> = {
  pass: "verdict.pass",
  fix: "verdict.fix",
  fail: "verdict.fail",
};

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

function IssueRow({ issue, globalLabel }: { issue: QAIssue; globalLabel: string }) {
  return (
    <div className="issue-row">
      <span className={`issue-dot ${issue.severity}`} />
      <div>
        <div className="issue-meta">
          <span className="issue-code">{issue.code}</span>
          <span>{issue.atMs ? fmtDuration(issue.atMs) : globalLabel}</span>
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
  copyLabel,
  onCopy,
}: {
  label: string;
  path: string;
  copyLabel: string;
  onCopy: (value: string) => void;
}) {
  return (
    <div className="file-row">
      <span className="file-label">{label}</span>
      <code title={path}>{shorten(path, 44)}</code>
      <button type="button" className="icon-button" onClick={() => onCopy(path)} aria-label={copyLabel}>
        <Copy size={13} />
      </button>
    </div>
  );
}

export function App() {
  const [lang, setLang] = useState<Lang>(detectLang);
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
  const [busy, setBusy] = useState<BusyKey | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [videoNonce, setVideoNonce] = useState(0);
  const [useFixed, setUseFixed] = useState(false);
  const [videoError, setVideoError] = useState(false);

  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(lang, key, vars);

  const changeLang = (next: Lang) => {
    if (next === lang) return;
    setLang(next);
    setError("");
    setNotice("");
  };

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    try {
      window.localStorage.setItem("auteur.studio.lang", lang);
    } catch {
      // Persistence is best-effort; the toggle still works for this session.
    }
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has("lang")) {
        url.searchParams.delete("lang");
        window.history.replaceState(null, "", url.pathname + url.search + url.hash);
      }
    } catch {
      // The language already applied; cleanup is only cosmetic.
    }
  }, [lang]);

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

  const sceneCountLabel = (count: number) =>
    t(count === 1 ? "plan.sceneOne" : "plan.scenes", { count });
  const calloutCountLabel = (count: number) =>
    t(count === 1 ? "plan.calloutOne" : "plan.callouts", { count });
  const issueCountLabel = (count: number) =>
    t(count === 1 ? "qa.issueOne" : "qa.issues", { count });
  const modelCountLabel = (count: number) =>
    t(count === 1 ? "top.modelOne" : "top.models", { count });
  const engineModelCountLabel = (count: number) =>
    t(count === 1 ? "engine.modelOneAvailable" : "engine.modelsAvailable", { count });

  const videoUrl = useMemo(() => {
    if (!currentRun?.hasVideo) return "";
    const base = useFixed && currentRun.hasFixed ? currentRun.fixedVideoUrl : currentRun.videoUrl;
    return withVersion(base, currentRun.videoUpdatedAt + videoNonce);
  }, [currentRun, useFixed, videoNonce]);

  const runBusy = async (key: BusyKey, action: () => Promise<void>) => {
    setBusy(key);
    setStartedAt(Date.now());
    setNow(Date.now());
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(t(doneLabels[key]));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
      setStartedAt(null);
    }
  };

  const generateFilm = () =>
    runBusy("generate", async () => {
      if (!brief.trim()) throw new Error(t("error.writeBrief"));
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
    runBusy("plan", async () => {
      if (!brief.trim()) throw new Error(t("error.writeBrief"));
      const data = await post<{ run: RunSummary }>("/api/plan", {
        brief,
        ratio,
        layout,
      });
      await refreshRuns();
      await loadRun(data.run.id);
    });

  const render = () =>
    runBusy("render", async () => {
      if (!currentId) throw new Error(t("error.selectRun"));
      await post("/api/render", { runId: currentId, quality, mode: renderMode });
      await loadRun(currentId);
      await refreshRuns();
    });

  const review = () =>
    runBusy("qa", async () => {
      if (!currentId) throw new Error(t("error.selectRun"));
      await post("/api/qa", { runId: currentId });
      await loadRun(currentId);
      await refreshRuns();
    });

  const fix = () =>
    runBusy("fix", async () => {
      if (!currentId) throw new Error(t("error.selectRun"));
      await post("/api/fix", { runId: currentId, quality, mode: renderMode });
      await loadRun(currentId);
      await refreshRuns();
    });

  const addVoice = () =>
    runBusy("voice", async () => {
      if (!currentId) throw new Error(t("error.generateVideo"));
      if (!voiceText.trim()) throw new Error(t("error.writeVoice"));
      await post("/api/voice", { runId: currentId, text: voiceText });
      await loadRun(currentId);
      await refreshRuns();
    });

  const savePlan = () =>
    runBusy("save", async () => {
      if (!currentId) throw new Error(t("error.selectRunFirst"));
      const parsed = JSON.parse(jsonDraft) as unknown;
      await post("/api/plan/save", { runId: currentId, plan: parsed });
      await loadRun(currentId);
      await refreshRuns();
    });

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(t("notice.copied"));
    } catch {
      setError(t("error.clipboard"));
    }
  };

  const importBrief = (id: string) => {
    const file = briefs.find((item) => item.id === id);
    if (file) setBrief(file.content);
  };

  const videoLabel =
    useFixed && currentRun?.hasFixed ? t("preview.fixed") : t("preview.original");

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
            aria-label={t("top.selectRun")}
          >
            {runs.length === 0 ? <option value="">{t("top.noRuns")}</option> : null}
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
            aria-label={t("top.refreshRuns")}
            title={t("top.refreshRuns")}
          >
            <RefreshCw size={13} />
          </button>
        </div>
        <div className="top-status" title={status?.error ?? t("top.localRelay")}>
          <span className={`status-dot ${status?.ok && modelsCount > 0 ? "ok" : "bad"}`} />
          <span>{status?.ok ? modelCountLabel(modelsCount) : t("top.relayUnavailable")}</span>
          <span className="top-muted">{directorModel ? shorten(directorModel.model, 34) : t("top.noModel")}</span>
        </div>
        <div className="top-meta">
          <div className="lang-switch" role="group" aria-label={t("language.label")}>
            <button
              type="button"
              className={lang === "en" ? "active" : ""}
              aria-pressed={lang === "en"}
              onClick={() => changeLang("en")}
            >
              EN
            </button>
            <button
              type="button"
              className={lang === "zh" ? "active" : ""}
              aria-pressed={lang === "zh"}
              onClick={() => changeLang("zh")}
            >
              中文
            </button>
          </div>
          <span className="top-local">{t("top.localNoCloud")}</span>
        </div>
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
          <button type="button" className="icon-button" onClick={() => setError("")} aria-label={t("banner.dismissError")}>
            <X size={13} />
          </button>
        </div>
      ) : null}

      {notice ? (
        <div className="banner notice" role="status">
          <Check size={14} />
          <span>{notice}</span>
          <button type="button" className="icon-button" onClick={() => setNotice("")} aria-label={t("banner.dismissMessage")}>
            <X size={13} />
          </button>
        </div>
      ) : null}

      <main className="workspace">
        <aside className="left">
          <div className="section-head">
            <span>{t("brief.title")}</span>
            <span className="section-hint">{t("brief.shortcut")}</span>
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
            placeholder={t("brief.placeholder")}
            aria-label={t("brief.aria")}
          />
          <div className="preset-row">
            <select
              value=""
              onChange={(event) => importBrief(event.target.value)}
              aria-label={t("brief.presetAria")}
            >
              <option value="">{t("brief.preset")}</option>
              {briefs.map((file) => (
                <option key={file.id} value={file.id}>
                  {file.title}
                </option>
              ))}
            </select>
          </div>

          <div className="field-grid">
            <label>
              <span className="field-label">{t("field.ratio")}</span>
              <div className="segmented" role="group" aria-label={t("field.ratioAria")}>
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
              <span className="field-label">{t("field.layout")}</span>
              <select value={layout} onChange={(event) => setLayout(event.target.value as Layout)}>
                <option value="auto">{t("layout.auto")}</option>
                <option value="device">{t("layout.device")}</option>
                <option value="data">{t("layout.data")}</option>
                <option value="type">{t("layout.type")}</option>
                <option value="hook">{t("layout.hook")}</option>
              </select>
            </label>
            <label>
              <span className="field-label">{t("field.quality")}</span>
              <select value={quality} onChange={(event) => setQuality(event.target.value as Quality)}>
                <option value="draft">{t("quality.draft")}</option>
                <option value="looks">{t("quality.looks")}</option>
                <option value="delivery">{t("quality.delivery")}</option>
              </select>
            </label>
            <label>
              <span className="field-label">{t("field.renderMode")}</span>
              <select value={renderMode} onChange={(event) => setRenderMode(event.target.value as RenderMode)}>
                <option value="full">{t("mode.full")}</option>
                <option value="scenes">{t("mode.scenes")}</option>
              </select>
            </label>
          </div>

          <div className="primary-actions">
            <button type="button" className="button primary" onClick={() => void generateFilm()} disabled={Boolean(busy)}>
              {busy === "generate" ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />}
              {busy === "generate" ? t("action.working", { seconds: elapsed }) : t("action.generateFilm")}
            </button>
            <button type="button" className="button ghost" onClick={() => void planOnly()} disabled={Boolean(busy)}>
              <Braces size={14} />
              {t("action.planOnly")}
            </button>
          </div>
          <p className="hint">{t("hint.plan")}</p>

          <div className="rule" />

          <div className="section-head">
            <span>{t("voice.title")}</span>
            <span className="section-hint">{t("voice.local")}</span>
          </div>
          <textarea
            className="voice-input"
            value={voiceText}
            onChange={(event) => setVoiceText(event.target.value)}
            placeholder={t("voice.placeholder")}
            aria-label={t("voice.aria")}
          />
          <button type="button" className="button ghost wide" onClick={() => void addVoice()} disabled={Boolean(busy) || !currentRun?.hasVideo}>
            {busy === "voice" ? <Loader2 size={14} className="spin" /> : <Mic size={14} />}
            {currentRun?.hasVoice ? t("action.regenerateVoice") : t("action.generateVoice")}
          </button>

          <div className="rule" />

          <div className="section-head">
            <span>{t("engine.title")}</span>
            <span className="section-hint">{t("engine.local")}</span>
          </div>
          <div className="engine-line">
            <span className={`status-dot ${status?.ok && modelsCount > 0 ? "ok" : "bad"}`} />
            <span>{status?.ok ? engineModelCountLabel(modelsCount) : status?.error ?? t("top.relayUnavailable")}</span>
          </div>
          <div className="engine-line muted">
            <span>{t("engine.director")}</span>
            <code>{directorModel?.id ?? t("engine.unassigned")}</code>
          </div>
          <div className="engine-line muted">
            <span>{t("engine.vision")}</span>
            <code>{status?.models?.find((model) => model.images === "yes")?.id ?? t("engine.deterministicOnly")}</code>
          </div>
          <p className="hint">{t("hint.keys")}</p>
        </aside>

        <section className="center">
          <div className="center-head">
            <div>
              <div className="eyebrow">{t("plan.eyebrow")}</div>
              <h1>{plan?.brand?.name ?? t("plan.none")}</h1>
            </div>
            <div className="center-meta">
              {plan ? `${sceneCountLabel(scenes.length)} · ${fmtDuration(total)} · ${plan.ratio}` : t("plan.waiting")}
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
                      {(scene.callouts?.length ?? 0) > 0 ? <span>{calloutCountLabel(scene.callouts?.length ?? 0)}</span> : null}
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
              <strong>{t("plan.none")}</strong>
              <span>{t("plan.emptyHint")}</span>
              <button type="button" className="button ghost" onClick={() => void planOnly()} disabled={Boolean(busy)}>
                <Braces size={14} />
                {t("action.generatePlan")}
              </button>
            </div>
          )}

          {runs.length > 1 ? (
            <div className="runs-block">
              <div className="section-head">
                <span>{t("runs.recent")}</span>
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
                    <span>{sceneCountLabel(run.scenes)}</span>
                    <span className={`run-score ${run.verdict ?? "none"}`}>{run.score ?? "—"}</span>
                    <span className="run-time">{new Date(run.createdAt).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US")}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {plan ? (
            <details className="json-editor">
              <summary>
                <span>{t("plan.editJson")}</span>
                <span className="section-hint">{t("plan.advanced")}</span>
              </summary>
              <textarea
                value={jsonDraft}
                onChange={(event) => setJsonDraft(event.target.value)}
                spellCheck={false}
                aria-label={t("plan.jsonAria")}
              />
              <div className="json-actions">
                <span className="hint">{t("hint.savePlan")}</span>
                <button type="button" className="button ghost" onClick={() => void savePlan()} disabled={Boolean(busy)}>
                  {busy === "save" ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
                  {t("action.savePlan")}
                </button>
              </div>
            </details>
          ) : null}
        </section>

        <aside className="right">
          <div className="preview-head">
            <div className="eyebrow">{t("preview.title")}</div>
            <div className="preview-tools">
              {currentRun?.hasFixed ? (
                <div className="segmented small">
                  <button type="button" className={!useFixed ? "active" : ""} onClick={() => setUseFixed(false)}>
                    {t("preview.original")}
                  </button>
                  <button type="button" className={useFixed ? "active" : ""} onClick={() => setUseFixed(true)}>
                    {t("preview.fixed")}
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
                <span>{currentRun?.hasPlan ? t("preview.render") : t("preview.generatePlan")}</span>
              </div>
            )}
            {videoError ? <div className="video-error">{t("preview.error")}</div> : null}
          </div>

          <div className="qa-block">
            <div className="qa-head">
              <div className="eyebrow">QA</div>
              {qa ? <span className={`verdict ${qa.verdict}`}>{t(verdictLabels[qa.verdict])}</span> : <span className="verdict none">{t("verdict.none")}</span>}
              {qa ? <span className="issue-count">{issueCountLabel(qa.issues.length)}</span> : null}
              <span className="qa-score">{qa ? qa.score : "—"}</span>
            </div>
            {qa ? (
              <>
                <div className="rubric-row">
                  <span>DOM {qa.rubric.dom}</span>
                  <span>{t("qa.media")} {qa.rubric.media}</span>
                  <span>HF {qa.rubric.hyperframes ?? "—"}</span>
                  <span>VLM {qa.rubric.vlm ?? "—"}</span>
                </div>
                <div className="issue-list">
                  {qa.issues.length === 0 ? (
                    <div className="qa-empty"><Check size={14} /> {t("qa.empty")}</div>
                  ) : (
                    qa.issues.map((issue) => <IssueRow issue={issue} globalLabel={t("issue.global")} key={issue.id} />)
                  )}
                </div>
              </>
            ) : (
              <div className="qa-empty">
                <ShieldCheck size={14} />
                {currentRun?.hasVideo ? t("qa.inspect") : t("qa.renderFirst")}
              </div>
            )}
          </div>

          <div className="action-row">
            <button type="button" className="button" onClick={() => void render()} disabled={Boolean(busy) || !currentRun?.hasPlan}>
              {busy === "render" ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
              {t("action.render")}
            </button>
            <button type="button" className="button" onClick={() => void review()} disabled={Boolean(busy) || !currentRun?.hasVideo}>
              {busy === "qa" ? <Loader2 size={14} className="spin" /> : <ShieldCheck size={14} />}
              {t("action.qa")}
            </button>
            <button type="button" className="button" onClick={() => void fix()} disabled={Boolean(busy) || !currentRun?.hasQa}>
              {busy === "fix" ? <Loader2 size={14} className="spin" /> : <Wrench size={14} />}
              {t("action.fix")}
            </button>
          </div>

          <div className="files-block">
            <div className="section-head">
              <span>{t("files.title")}</span>
              <span className="section-hint">{currentId ?? t("files.noRun")}</span>
            </div>
            {currentId ? (
              <>
                <FileRow
                  label={t("files.video")}
                  path={`runs/${currentId}/out/video.mp4`}
                  copyLabel={t("files.copyPath", { label: t("files.video") })}
                  onCopy={copy}
                />
                <FileRow
                  label={t("files.plan")}
                  path={`runs/${currentId}/plan.json`}
                  copyLabel={t("files.copyPath", { label: t("files.plan") })}
                  onCopy={copy}
                />
                {currentRun?.hasQa ? (
                  <FileRow
                    label={t("files.qa")}
                    path={`runs/${currentId}/qa.md`}
                    copyLabel={t("files.copyPath", { label: t("files.qa") })}
                    onCopy={copy}
                  />
                ) : null}
                {currentRun?.hasVoice ? (
                  <FileRow
                    label={t("files.voice")}
                    path={`runs/${currentId}/voice.wav`}
                    copyLabel={t("files.copyPath", { label: t("files.voice") })}
                    onCopy={copy}
                  />
                ) : null}
                <FileRow
                  label={t("files.html")}
                  path={`runs/${currentId}/composition/index.html`}
                  copyLabel={t("files.copyPath", { label: t("files.html") })}
                  onCopy={copy}
                />
              </>
            ) : (
              <div className="files-empty">{t("files.empty")}</div>
            )}
          </div>

          {qa?.notes?.length ? (
            <details className="notes-block">
              <summary>
                <span>{t("notes.title")}</span>
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

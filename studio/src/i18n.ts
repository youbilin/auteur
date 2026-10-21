export type Lang = "en" | "zh";

export const en = {
  "language.label": "Language",

  "top.selectRun": "Select a run",
  "top.noRuns": "No runs",
  "top.refreshRuns": "Refresh runs",
  "top.localRelay": "Local relay",
  "top.models": "{count} models",
  "top.modelOne": "{count} model",
  "top.relayUnavailable": "Relay unavailable",
  "top.noModel": "no model",
  "top.localNoCloud": "Local · no cloud",

  "banner.dismissError": "Dismiss error",
  "banner.dismissMessage": "Dismiss message",

  "brief.title": "Brief",
  "brief.shortcut": "⌘↵ generate",
  "brief.placeholder": "Describe the product, audience, tone, look, and three scenes.",
  "brief.aria": "Product brief",
  "brief.presetAria": "Load a brief preset",
  "brief.preset": "Load brief preset…",

  "field.ratio": "Ratio",
  "field.ratioAria": "Aspect ratio",
  "field.layout": "Layout",
  "field.quality": "Quality",
  "field.renderMode": "Render mode",

  "layout.auto": "Auto",
  "layout.device": "Device",
  "layout.data": "Data",
  "layout.type": "Type",
  "layout.hook": "Hook",

  "quality.draft": "Draft",
  "quality.looks": "Looks",
  "quality.delivery": "Delivery",

  "mode.full": "Full",
  "mode.scenes": "Scenes",

  "action.generateFilm": "Generate film",
  "action.planOnly": "Plan only",
  "action.generatePlan": "Generate plan",
  "action.savePlan": "Save plan",
  "action.generateVoice": "Generate voiceover",
  "action.regenerateVoice": "Regenerate voiceover",
  "action.render": "Render",
  "action.qa": "QA",
  "action.fix": "Fix",
  "action.working": "Working {seconds}s",

  "hint.plan": "The model writes a typed plan. The template owns layout, type, motion, and audio.",
  "hint.keys": "Keys stay in `.env.local`. The Studio server binds to 127.0.0.1.",
  "hint.savePlan": "Saving recompiles the composition; render to see changes.",

  "voice.title": "Voiceover",
  "voice.local": "SAPI · local",
  "voice.placeholder": "One or two sentences. Optional.",
  "voice.aria": "Voiceover text",

  "engine.title": "Engine",
  "engine.local": "local",
  "engine.modelsAvailable": "{count} models available",
  "engine.modelOneAvailable": "{count} model available",
  "engine.director": "Director",
  "engine.vision": "Vision",
  "engine.unassigned": "unassigned",
  "engine.deterministicOnly": "deterministic only",

  "plan.eyebrow": "Plan",
  "plan.none": "No plan yet",
  "plan.waiting": "waiting for a brief",
  "plan.scenes": "{count} scenes",
  "plan.sceneOne": "{count} scene",
  "plan.callouts": "{count} callouts",
  "plan.calloutOne": "{count} callout",
  "plan.emptyHint": "Write a brief on the left, then generate a plan or the whole film.",
  "plan.editJson": "Edit plan JSON",
  "plan.advanced": "advanced",
  "plan.jsonAria": "Plan JSON",

  "runs.recent": "Recent runs",

  "preview.title": "Preview",
  "preview.original": "Original",
  "preview.fixed": "Fixed",
  "preview.render": "Render to preview",
  "preview.generatePlan": "Generate a plan first",
  "preview.error": "Video could not load. Check the render log.",

  "qa.issues": "{count} issues",
  "qa.issueOne": "{count} issue",
  "qa.empty": "No issues. Human review still required.",
  "qa.inspect": "Run QA to inspect the current film.",
  "qa.renderFirst": "Render a film, then run QA.",
  "qa.media": "Media",
  "verdict.pass": "pass",
  "verdict.fix": "fix",
  "verdict.fail": "fail",
  "verdict.none": "not run",

  "files.title": "Files",
  "files.noRun": "no run",
  "files.video": "video",
  "files.plan": "plan",
  "files.qa": "qa",
  "files.voice": "voice",
  "files.html": "html",
  "files.copyPath": "Copy {label} path",
  "files.empty": "No run selected.",

  "notes.title": "Notes",

  "issue.global": "global",

  "error.writeBrief": "Write a brief first.",
  "error.selectRun": "Generate or select a run first.",
  "error.generateVideo": "Generate a video first.",
  "error.writeVoice": "Write voiceover text first.",
  "error.selectRunFirst": "Select a run first.",
  "error.clipboard": "Clipboard is unavailable in this browser.",
  "notice.copied": "Path copied",

  "busy.generate": "Generating film",
  "busy.plan": "Writing plan",
  "busy.render": "Rendering",
  "busy.qa": "Running QA",
  "busy.fix": "Fixing",
  "busy.voice": "Generating voiceover",
  "busy.save": "Saving plan",

  "done.generate": "Film generated",
  "done.plan": "Plan generated",
  "done.render": "Render complete",
  "done.qa": "QA complete",
  "done.fix": "Fix complete",
  "done.voice": "Voiceover generated",
  "done.save": "Plan saved",
} as const;

export type MessageKey = keyof typeof en;

const zh: Record<MessageKey, string> = {
  "language.label": "语言",

  "top.selectRun": "选择运行",
  "top.noRuns": "暂无运行",
  "top.refreshRuns": "刷新运行",
  "top.localRelay": "本地中转",
  "top.models": "{count} 个模型",
  "top.modelOne": "{count} 个模型",
  "top.relayUnavailable": "中转不可用",
  "top.noModel": "无模型",
  "top.localNoCloud": "本地 · 无云端",

  "banner.dismissError": "关闭错误",
  "banner.dismissMessage": "关闭提示",

  "brief.title": "简报",
  "brief.shortcut": "⌘↵ 生成",
  "brief.placeholder": "描述产品、受众、语气、视觉风格和三个场景。",
  "brief.aria": "产品简报",
  "brief.presetAria": "加载简报预设",
  "brief.preset": "加载简报预设…",

  "field.ratio": "画幅",
  "field.ratioAria": "画幅比例",
  "field.layout": "布局",
  "field.quality": "质量",
  "field.renderMode": "渲染模式",

  "layout.auto": "自动",
  "layout.device": "设备",
  "layout.data": "数据",
  "layout.type": "文字",
  "layout.hook": "钩子",

  "quality.draft": "草稿",
  "quality.looks": "精修",
  "quality.delivery": "交付",

  "mode.full": "整片",
  "mode.scenes": "分场景",

  "action.generateFilm": "生成影片",
  "action.planOnly": "只生成分镜",
  "action.generatePlan": "生成分镜",
  "action.savePlan": "保存分镜",
  "action.generateVoice": "生成配音",
  "action.regenerateVoice": "重新生成配音",
  "action.render": "渲染",
  "action.qa": "QA",
  "action.fix": "修复",
  "action.working": "处理中 {seconds}s",

  "hint.plan": "模型只写受约束的分镜，版式、字体、动效和音频由模板负责。",
  "hint.keys": "密钥只放在 `.env.local`。Studio 服务只绑定 127.0.0.1。",
  "hint.savePlan": "保存后会重新编译合成，渲染后才能看到变化。",

  "voice.title": "配音",
  "voice.local": "SAPI · 本地",
  "voice.placeholder": "一两句话，可选。",
  "voice.aria": "配音文本",

  "engine.title": "引擎",
  "engine.local": "本地",
  "engine.modelsAvailable": "{count} 个模型可用",
  "engine.modelOneAvailable": "{count} 个模型可用",
  "engine.director": "导演",
  "engine.vision": "视觉",
  "engine.unassigned": "未分配",
  "engine.deterministicOnly": "仅确定性检查",

  "plan.eyebrow": "分镜",
  "plan.none": "尚未生成分镜",
  "plan.waiting": "等待简报",
  "plan.scenes": "{count} 幕",
  "plan.sceneOne": "{count} 幕",
  "plan.callouts": "{count} 条标注",
  "plan.calloutOne": "{count} 条标注",
  "plan.emptyHint": "在左侧填写简报，然后生成分镜或整片。",
  "plan.editJson": "编辑分镜 JSON",
  "plan.advanced": "高级",
  "plan.jsonAria": "分镜 JSON",

  "runs.recent": "最近运行",

  "preview.title": "预览",
  "preview.original": "原片",
  "preview.fixed": "修复版",
  "preview.render": "渲染后预览",
  "preview.generatePlan": "请先生成分镜",
  "preview.error": "视频加载失败，请检查渲染日志。",

  "qa.issues": "{count} 个问题",
  "qa.issueOne": "{count} 个问题",
  "qa.empty": "无问题。仍需人工复核。",
  "qa.inspect": "运行 QA 检查当前影片。",
  "qa.renderFirst": "先渲染影片，再运行 QA。",
  "qa.media": "媒体",
  "verdict.pass": "通过",
  "verdict.fix": "需修复",
  "verdict.fail": "未通过",
  "verdict.none": "未运行",

  "files.title": "文件",
  "files.noRun": "无运行",
  "files.video": "视频",
  "files.plan": "分镜",
  "files.qa": "QA",
  "files.voice": "配音",
  "files.html": "HTML",
  "files.copyPath": "复制 {label} 路径",
  "files.empty": "未选择运行。",

  "notes.title": "备注",

  "issue.global": "全局",

  "error.writeBrief": "请先填写简报。",
  "error.selectRun": "请先生成或选择一次运行。",
  "error.generateVideo": "请先生成视频。",
  "error.writeVoice": "请先填写配音文本。",
  "error.selectRunFirst": "请先选择一次运行。",
  "error.clipboard": "当前浏览器无法访问剪贴板。",
  "notice.copied": "路径已复制",

  "busy.generate": "正在生成影片",
  "busy.plan": "正在生成分镜",
  "busy.render": "正在渲染",
  "busy.qa": "正在运行 QA",
  "busy.fix": "正在修复",
  "busy.voice": "正在生成配音",
  "busy.save": "正在保存分镜",

  "done.generate": "影片已生成",
  "done.plan": "分镜已生成",
  "done.render": "渲染完成",
  "done.qa": "QA 完成",
  "done.fix": "修复完成",
  "done.voice": "配音已生成",
  "done.save": "分镜已保存",
};

const dictionaries: Record<Lang, Record<MessageKey, string>> = { en, zh };

export function detectLang(): Lang {
  try {
    const requested = new URL(window.location.href).searchParams.get("lang");
    if (requested === "en" || requested === "zh") return requested;
  } catch {
    // Ignore malformed URLs; fall back to stored/system language.
  }
  try {
    const stored = window.localStorage.getItem("auteur.studio.lang");
    if (stored === "en" || stored === "zh") return stored;
  } catch {
    // Storage can be unavailable in private contexts.
  }
  return navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function translate(
  lang: Lang,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const template = dictionaries[lang][key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

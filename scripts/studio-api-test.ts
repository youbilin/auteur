const base = "http://127.0.0.1:4310";

async function post(path: string, body: unknown): Promise<any> {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(`${path}: ${data.error ?? response.status}`);
  return data;
}

async function get(path: string): Promise<any> {
  const response = await fetch(`${base}${path}`);
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(`${path}: ${data.error ?? response.status}`);
  return data;
}

const status = await get("/api/status");
console.log("models", status.models?.length, status.ok);

const plan = await post("/api/plan", {
  runId: "studio-test",
  ratio: "16:9",
  layout: "auto",
  brief: `# Loom — calm releases

Create a 10-second, 16:9 product film for Loom, a calm release workspace for small software teams. Dark look, accent #8BD3FF.
Two or three scenes: a release overview, a live preview, and a final ready-to-ship state. Short copy, one callout per scene.`,
});
console.log("plan", plan.run.id, plan.run.scenes, plan.run.durationMs);

const rendered = await post("/api/render", { runId: "studio-test", quality: "draft" });
console.log("render", rendered.run.hasVideo, rendered.run.videoUrl);

const reviewed = await post("/api/qa", { runId: "studio-test" });
console.log("qa", reviewed.qa.score, reviewed.qa.verdict, "vlm", reviewed.qa.rubric.vlm ?? "n/a");

const detail = await get("/api/runs/studio-test");
await post("/api/plan/save", { runId: "studio-test", plan: detail.plan });
console.log("save plan ok", Boolean(detail.plan?.scenes?.length));

const voice = await post("/api/voice", {
  runId: "studio-test",
  text: "Auteur turns a brief into a film. The plan stays editable, and the critic keeps it honest.",
});
console.log("voice", voice.run.hasVoice, voice.run.hasVideo);

const final = await get(`/api/runs/${voice.run.id}`);
console.log("final", final.run.score, final.run.verdict, final.run.hasVoice, final.run.durationMs);

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

const runId = process.argv[2] ?? "studio-test";
const reviewed = await post("/api/qa", { runId });
console.log("qa", reviewed.qa.score, reviewed.qa.verdict, "rubric", reviewed.qa.rubric);
console.log("vlm issues", reviewed.qa.issues.filter((issue: any) => issue.critic === "vlm").length);
console.log("notes", reviewed.qa.notes.filter((note: string) => note.startsWith("VLM")));

const voice = await post("/api/voice", {
  runId,
  text: "Auteur turns a brief into a film. The plan stays editable, and the critic keeps it honest.",
});
console.log("voice", voice.run.hasVoice, "video", voice.run.videoUrl);

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { compositionDir, ensureDir, readJson, runDir } from "../src/core/paths.js";
import { VideoPlanSchema } from "../src/plans/schema.js";

const runId = process.argv[2] ?? "arc-release";
const times = (process.argv[3] ?? "1000,3000,6000,10000")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value));

const plan = VideoPlanSchema.parse(readJson(path.join(runDir(runId), "plan.json")));
const htmlPath = path.join(compositionDir(runId), "index.html");
const outDir = ensureDir(path.join(runDir(runId), "frames"));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: plan.width, height: plan.height },
  deviceScaleFactor: 1,
});
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
await page.waitForFunction("window.__auteurReady === true", { timeout: 15000 });

for (const time of times) {
  await page.evaluate(
    `(async () => { window.__auteur.seek(${time}); await new Promise(function (resolve) { setTimeout(resolve, 120); }); })()`,
  );
  const file = path.join(outDir, `at-${time}.png`);
  await page.screenshot({ path: file });
  console.log(file);
}

await browser.close();

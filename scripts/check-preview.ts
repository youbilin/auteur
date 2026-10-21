import path from "node:path";
import { chromium } from "playwright";
import { ensureDir, runDir } from "../src/core/paths.js";

const url = process.argv[2] ?? "http://127.0.0.1:4321/?preview=1";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(url, { waitUntil: "load" });
await page.waitForFunction("window.__auteurReady === true", { timeout: 15000 });
const hasBar = Boolean(await page.$(".preview-bar"));
if (!hasBar) throw new Error("preview bar was not created");

await page.evaluate(
  `(async () => {
    window.__auteur.seek(6000);
    document.querySelector(".preview-bar input").value = "6000";
    document.querySelector(".preview-bar input").dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(function (resolve) { setTimeout(resolve, 100); });
  })()`,
);

const state = await page.evaluate(
  `({
    time: window.__auteur.getTime(),
    slider: document.querySelector(".preview-bar input").value,
    label: document.querySelector(".preview-bar .preview-time").textContent
  })`,
);
console.log(state);

const dir = ensureDir(path.join(runDir("arc-release"), "frames"));
await page.screenshot({ path: path.join(dir, "preview.png") });
await browser.close();

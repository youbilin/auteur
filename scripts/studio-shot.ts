import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { ensureDir, PROJECT_ROOT } from "../src/core/paths.js";

const out = ensureDir(path.join(PROJECT_ROOT, "runs", "bench"));
const targetRun = process.argv[2];
const browser = await chromium.launch({ headless: true });
const errors: string[] = [];

const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
desktop.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
desktop.on("pageerror", (error) => errors.push(error.message));
await desktop.goto("http://127.0.0.1:4310", { waitUntil: "networkidle" });
if (targetRun) {
  await desktop.selectOption(".run-switcher select", targetRun);
  await desktop.waitForTimeout(800);
}
await desktop.waitForTimeout(1200);
await desktop.screenshot({ path: path.join(out, "studio-desktop.png") });

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
mobile.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
await mobile.goto("http://127.0.0.1:4310", { waitUntil: "networkidle" });
if (targetRun) {
  await mobile.selectOption(".run-switcher select", targetRun);
  await mobile.waitForTimeout(600);
}
await mobile.waitForTimeout(800);
await mobile.screenshot({ path: path.join(out, "studio-mobile.png"), fullPage: true });

console.log(path.join(out, "studio-desktop.png"));
console.log(path.join(out, "studio-mobile.png"));
console.log("errors:", errors.length ? errors.slice(0, 8) : "none");
await browser.close();

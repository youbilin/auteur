import path from "node:path";
import { chromium } from "playwright";
import { z } from "zod";
import { ensureDir, writeJson } from "../core/paths.js";
import { log } from "../core/log.js";
import { ModelClient, modelsUrl } from "./client.js";
import type { CapabilitiesFile, Capability, ResolvedModel, SupportState } from "./schema.js";

const OkSchema = z.object({ ok: z.boolean() });

async function makeProbeImage(): Promise<string | null> {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;width:64px;height:64px;background:#fff;display:grid;place-items:center;font:700 44px/1 Arial,sans-serif;color:#000">A</body></html>`,
    );
    const buffer = await page.screenshot({ type: "png" });
    return buffer.toString("base64");
  } catch (error) {
    log.warn(`Could not create vision probe image: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function probeModelList(model: ResolvedModel): Promise<string[] | undefined> {
  try {
    const response = await fetch(modelsUrl(model.baseUrl), {
      headers: { Authorization: `Bearer ${model.apiKey}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) return undefined;
    const data = (await response.json()) as { data?: Array<{ id?: unknown }> };
    return (data.data ?? [])
      .map((item) => item.id)
      .filter((id): id is string => typeof id === "string")
      .slice(0, 80);
  } catch {
    return undefined;
  }
}

function looksLikeRefusal(text: string): boolean {
  return /cannot|can't|unable|no image|text[- ]only|sorry|not able|无法|不能/i.test(text);
}

async function probeVision(model: ResolvedModel, image: string): Promise<SupportState> {
  const client = new ModelClient({
    id: model.id,
    baseUrl: model.baseUrl,
    apiKey: model.apiKey,
    model: model.modelName,
    timeoutMs: 60000,
    retries: 0,
    supports: model.supports,
  });

  try {
    const result = await client.call(
      [
        {
          role: "user",
          content: [
            { type: "text", text: "What single uppercase letter is shown in this image? Reply with one character." },
            { type: "image_url", image_url: { url: `data:image/png;base64,${image}` } },
          ],
        },
      ],
      { temperature: 0, maxTokens: 128 },
    );
    if (/^\s*A\s*$/i.test(result.content.trim()) || /\bA\b/.test(result.content)) return "yes";
    if (looksLikeRefusal(result.content)) return "no";
    return "unknown";
  } catch (error) {
    log.warn(`${model.id}: vision probe failed (${error instanceof Error ? error.message : String(error)})`);
    return "unknown";
  }
}

async function probeJson(model: ResolvedModel): Promise<SupportState> {
  const client = new ModelClient({
    id: model.id,
    baseUrl: model.baseUrl,
    apiKey: model.apiKey,
    model: model.modelName,
    timeoutMs: 60000,
    retries: 0,
    supports: model.supports,
  });
  try {
    const result = await client.callJson(
      [
        { role: "system", content: "Return JSON only. No markdown. No commentary." },
        { role: "user", content: "Return {\"ok\":true}." },
      ],
      OkSchema,
      { temperature: 0, maxTokens: 256 },
    );
    return result.value.ok ? "yes" : "unknown";
  } catch (error) {
    log.warn(`${model.id}: JSON probe failed (${error instanceof Error ? error.message : String(error)})`);
    return "unknown";
  }
}

export async function probeModels(models: ResolvedModel[]): Promise<CapabilitiesFile> {
  if (models.length === 0) return {};
  const image = await makeProbeImage();
  const capabilities: CapabilitiesFile = {};

  for (const model of models) {
    const [modelList, json, images] = await Promise.all([
      probeModelList(model),
      probeJson(model),
      image ? probeVision(model, image) : Promise.resolve<SupportState>("unknown"),
    ]);
    const capability: Capability = {
      json,
      images,
      checkedAt: new Date().toISOString(),
      ...(modelList ? { models: modelList } : {}),
    };
    capabilities[model.id] = capability;
    const listHint = modelList ? ` · ${modelList.length} models listed` : "";
    log.info(`${model.id}: json=${json} images=${images}${listHint}`);
  }

  return capabilities;
}

export function writeCapabilities(capabilities: CapabilitiesFile, root = process.cwd()): string {
  const file = path.join(root, "config", "capabilities.local.json");
  ensureDir(path.dirname(file));
  writeJson(file, capabilities);
  return file;
}

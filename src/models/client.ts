import type { z } from "zod";
import { JsonParseError, ModelCallError, SchemaValidationError } from "../core/errors.js";
import type { SupportState } from "./schema.js";

export interface TextPart {
  type: "text";
  text: string;
}
export interface ImagePart {
  type: "image_url";
  image_url: { url: string };
}
export type MessageContent = string | Array<TextPart | ImagePart>;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: MessageContent;
}

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface UsageEntry {
  modelId: string;
  modelName: string;
  usage?: Usage;
  durationMs: number;
  ok: boolean;
  error?: string;
}

export interface ModelClientOptions {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  retries: number;
  supports: { json: SupportState; images: SupportState };
  onUsage?: (entry: UsageEntry) => void;
}

export interface CallOptions {
  temperature?: number;
  maxTokens?: number;
  responseFormat?: boolean;
  timeoutMs?: number;
}

export interface CallResult {
  content: string;
  usage?: Usage;
  model: string;
  durationMs: number;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function chatCompletionsUrl(baseUrl: string): string {
  const base = trimSlash(baseUrl);
  if (base.endsWith("/chat/completions")) return base;
  if (base.endsWith("/v1")) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

export function modelsUrl(baseUrl: string): string {
  const base = trimSlash(baseUrl);
  if (base.endsWith("/chat/completions")) return base.replace(/\/chat\/completions$/, "/models");
  if (base.endsWith("/v1")) return `${base}/models`;
  return `${base}/v1/models`;
}

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new JsonParseError("Model returned an empty response", text);

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // Fall through to bracket extraction.
  }

  const start = candidate.search(/[\[{]/);
  if (start < 0) throw new JsonParseError("No JSON object or array found in response", text);

  const open = candidate[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < candidate.length; i += 1) {
    const char = candidate[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === open) depth += 1;
    if (char === close) {
      depth -= 1;
      if (depth === 0) {
        const slice = candidate.slice(start, i + 1);
        try {
          return JSON.parse(slice);
        } catch (error) {
          throw new JsonParseError(
            `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
            text,
          );
        }
      }
    }
  }

  throw new JsonParseError("Unbalanced JSON in response", text);
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .join("");
  }
  if (content === null || content === undefined) return "";
  return String(content);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ModelClient {
  constructor(private readonly options: ModelClientOptions) {}

  get id(): string {
    return this.options.id;
  }

  get modelName(): string {
    return this.options.model;
  }

  async call(messages: ChatMessage[], callOptions: CallOptions = {}): Promise<CallResult> {
    const started = Date.now();
    const timeoutMs = callOptions.timeoutMs ?? this.options.timeoutMs;
    const url = chatCompletionsUrl(this.options.baseUrl);
    const apiKeyHeader = process.env.AUTEUR_API_KEY_HEADER?.trim() || "Authorization";
    const authValue = apiKeyHeader.toLowerCase() === "authorization"
      ? `Bearer ${this.options.apiKey}`
      : this.options.apiKey;

    const body: Record<string, unknown> = {
      model: this.options.model,
      messages,
      stream: false,
      temperature: callOptions.temperature ?? 0.3,
      max_tokens: callOptions.maxTokens ?? 4000,
    };

    if (callOptions.responseFormat) {
      body.response_format = { type: "json_object" };
    }

    let lastError: unknown;
    const attempts = this.options.retries + 1;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [apiKeyHeader]: authValue,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          const retryable = response.status === 429 || response.status >= 500;

          // Some relays reject response_format. Retry once without it.
          if (response.status === 400 && body.response_format) {
            delete body.response_format;
            lastError = new ModelCallError(
              `${this.options.id}: response_format rejected (${response.status})`,
              response.status,
              text.slice(0, 500),
            );
            continue;
          }

          if (retryable && attempt < attempts - 1) {
            await sleep(800 * 2 ** attempt);
            lastError = new ModelCallError(
              `${this.options.id}: HTTP ${response.status}`,
              response.status,
              text.slice(0, 500),
            );
            continue;
          }

          throw new ModelCallError(
            `${this.options.id}: HTTP ${response.status} ${text.slice(0, 300)}`,
            response.status,
            text,
          );
        }

        const data = (await response.json()) as {
          model?: string;
          choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown } }>;
          usage?: Usage;
        };
        const message = data.choices?.[0]?.message;
        const content = contentToText(message?.content) || contentToText(message?.reasoning_content);
        if (!content.trim()) {
          throw new ModelCallError(`${this.options.id}: empty content in response`);
        }

        const durationMs = Date.now() - started;
        this.options.onUsage?.({
          modelId: this.options.id,
          modelName: this.options.model,
          usage: data.usage,
          durationMs,
          ok: true,
        });

        return {
          content,
          usage: data.usage,
          model: data.model ?? this.options.model,
          durationMs,
        };
      } catch (error) {
        lastError = error;
        const isLast = attempt >= attempts - 1;
        const message = error instanceof Error ? error.message : String(error);
        const retryable =
          error instanceof TypeError ||
          /fetch failed|timeout|ECONNRESET|ETIMEDOUT|aborted|network/i.test(message);
        if (!retryable || isLast) break;
        await sleep(800 * 2 ** attempt);
      }
    }

    const durationMs = Date.now() - started;
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    this.options.onUsage?.({
      modelId: this.options.id,
      modelName: this.options.model,
      durationMs,
      ok: false,
      error: message,
    });
    throw lastError instanceof Error
      ? lastError
      : new ModelCallError(`${this.options.id}: ${message}`);
  }

  async callJson<T>(
    messages: ChatMessage[],
    schema: z.ZodType<T>,
    callOptions: CallOptions = {},
  ): Promise<{ value: T; raw: string; durationMs: number; usage?: Usage }> {
    const wantJson = this.options.supports.json !== "no" && callOptions.responseFormat !== false;
    const result = await this.call(messages, { ...callOptions, responseFormat: wantJson });
    let parsed: unknown;
    try {
      parsed = extractJson(result.content);
    } catch (error) {
      throw new JsonParseError(
        error instanceof Error ? error.message : String(error),
        result.content,
      );
    }

    const checked = schema.safeParse(parsed);
    if (!checked.success) {
      throw new SchemaValidationError(
        `Schema validation failed: ${checked.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ")}`,
        checked.error.issues,
      );
    }

    return {
      value: checked.data,
      raw: result.content,
      durationMs: result.durationMs,
      usage: result.usage,
    };
  }
}

import fs from "node:fs";
import path from "node:path";
import type { z } from "zod";
import { CONFIG_DIR, ensureDir, readJson } from "../core/paths.js";
import { env } from "../core/env.js";
import { JsonParseError, ModelCallError, SchemaValidationError } from "../core/errors.js";
import { log } from "../core/log.js";
import { ModelClient, type CallOptions, type ChatMessage, type UsageEntry } from "./client.js";
import {
  CapabilitiesFileSchema,
  ModelsConfigSchema,
  RolesConfigSchema,
  type CapabilitiesFile,
  type ModelConfig,
  type ModelsConfig,
  type ResolvedModel,
  type RoleConfig,
  type RoleName,
} from "./schema.js";

const DEFAULT_ROLE: Omit<RoleConfig, "chain"> = {
  temperature: 0.3,
  maxTokens: 8000,
  timeoutMs: 120000,
  retries: 2,
};

export function loadModelsConfig(root = process.cwd()): ModelsConfig {
  const local = path.join(root, "config", "models.json");
  const example = path.join(root, "config", "models.example.json");
  const file = fs.existsSync(local) ? local : example;
  if (!fs.existsSync(file)) {
    throw new Error(`Missing ${file}. Create it from config/models.example.json.`);
  }
  const raw = readJson<unknown>(file);
  const parsed = ModelsConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid ${file}: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  const rolesFile = path.join(root, "config", "roles.json");
  let roles = parsed.data.roles;
  if (fs.existsSync(rolesFile)) {
    const roleParsed = RolesConfigSchema.safeParse(readJson<unknown>(rolesFile));
    if (!roleParsed.success) {
      throw new Error(
        `Invalid ${rolesFile}: ${roleParsed.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ")}`,
      );
    }
    roles = { ...roles, ...roleParsed.data };
  }

  return { ...parsed.data, roles };
}

export function loadCapabilities(root = process.cwd()): CapabilitiesFile {
  const file = path.join(root, "config", "capabilities.local.json");
  if (!fs.existsSync(file)) return {};
  try {
    return CapabilitiesFileSchema.parse(readJson<unknown>(file));
  } catch (error) {
    log.warn(`Ignoring invalid capabilities file: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

export function resolveModels(
  config: ModelsConfig,
  capabilities: CapabilitiesFile = {},
): ResolvedModel[] {
  const resolved: ResolvedModel[] = [];
  for (const model of config.models) {
    const baseUrl = env(model.baseUrlEnv);
    const apiKey = env(model.apiKeyEnv);
    const modelName = model.modelEnv ? env(model.modelEnv) : model.model;
    if (!baseUrl || !apiKey || !modelName) {
      continue;
    }
    const capability = capabilities[model.id];
    resolved.push({
      config: model,
      id: model.id,
      baseUrl,
      apiKey,
      modelName,
      supports: {
        json: capability?.json ?? model.supports.json,
        images: capability?.images ?? model.supports.images,
      },
    });
  }
  return resolved;
}

export function missingModelEnv(config: ModelsConfig): Array<{ model: string; missing: string[] }> {
  const missing: Array<{ model: string; missing: string[] }> = [];
  const keys = new Set(config.models.flatMap((model) => [model.baseUrlEnv, model.apiKeyEnv, model.modelEnv].filter(Boolean) as string[]));
  for (const model of config.models) {
    const absent = [model.baseUrlEnv, model.apiKeyEnv, model.modelEnv]
      .filter((key): key is string => Boolean(key))
      .filter((key) => !env(key));
    if (absent.length > 0) missing.push({ model: model.id, missing: absent });
  }
  if (keys.size === 0) missing.push({ model: "(all)", missing: ["no model env configured"] });
  return missing;
}

export class ModelRegistry {
  private readonly clients = new Map<string, ModelClient>();
  private readonly roleMap: Partial<Record<RoleName, RoleConfig>>;

  constructor(
    private readonly models: ResolvedModel[],
    roles: Partial<Record<RoleName, RoleConfig>>,
    private readonly onUsage?: (entry: UsageEntry) => void,
  ) {
    this.roleMap = roles;
    for (const model of models) {
      this.clients.set(
        model.id,
        new ModelClient({
          id: model.id,
          baseUrl: model.baseUrl,
          apiKey: model.apiKey,
          model: model.modelName,
          timeoutMs: this.roleFor("director").timeoutMs,
          retries: this.roleFor("director").retries,
          supports: model.supports,
          onUsage,
        }),
      );
    }
  }

  roleFor(role: RoleName): RoleConfig {
    const configured = this.roleMap[role];
    if (configured) return configured;
    const fallback = this.models[0]?.id;
    return { ...DEFAULT_ROLE, chain: fallback ? [fallback] : [] };
  }

  hasRole(role: RoleName): boolean {
    const roleConfig = this.roleFor(role);
    return roleConfig.chain.some((id) => this.clients.has(id));
  }

  availableModelIds(): string[] {
    return [...this.clients.keys()];
  }

  private clientsFor(role: RoleName): Array<{ client: ModelClient; roleConfig: RoleConfig }> {
    const roleConfig = this.roleFor(role);
    const chain: ModelClient[] = [];
    for (const id of roleConfig.chain) {
      const client = this.clients.get(id);
      if (client) chain.push(client);
    }
    return chain.map((client) => ({ client, roleConfig }));
  }

  async callJson<T>(
    role: RoleName,
    messages: ChatMessage[],
    schema: z.ZodType<T>,
    options: CallOptions = {},
  ): Promise<T> {
    const chain = this.clientsFor(role);
    if (chain.length === 0) {
      throw new ModelCallError(
        `No configured model for role "${role}". Check .env.local and config/models.json.`,
      );
    }

    const failures: string[] = [];
    for (const { client, roleConfig } of chain) {
      const callOptions: CallOptions = {
        temperature: options.temperature ?? roleConfig.temperature,
        maxTokens: options.maxTokens ?? roleConfig.maxTokens,
        timeoutMs: options.timeoutMs ?? roleConfig.timeoutMs,
        responseFormat: options.responseFormat,
      };

      try {
        const result = await client.callJson(messages, schema, callOptions);
        return result.value;
      } catch (firstError) {
        const firstMessage = firstError instanceof Error ? firstError.message : String(firstError);
        failures.push(`${client.id}: ${firstMessage}`);

        const repairable =
          firstError instanceof JsonParseError || firstError instanceof SchemaValidationError;
        if (repairable) {
          const repairMessages: ChatMessage[] = [
            ...messages,
            {
              role: "user",
              content:
                `Your previous response was invalid: ${firstMessage}\n` +
                "Return ONLY valid JSON. No markdown fences, no commentary. " +
                "Keep every field inside the allowed bounds and follow the schema exactly.",
            },
          ];
          try {
            const repaired = await client.callJson(repairMessages, schema, callOptions);
            return repaired.value;
          } catch (repairError) {
            const repairMessage = repairError instanceof Error ? repairError.message : String(repairError);
            failures.push(`${client.id} repair: ${repairMessage}`);
          }
        }
      }
    }

    throw new ModelCallError(
      `All models failed for role "${role}".\n${failures.join("\n")}`,
    );
  }

  async callText(
    role: RoleName,
    messages: ChatMessage[],
    options: CallOptions = {},
  ): Promise<string> {
    const chain = this.clientsFor(role);
    if (chain.length === 0) {
      throw new ModelCallError(
        `No configured model for role "${role}". Check .env.local and config/models.json.`,
      );
    }
    const failures: string[] = [];
    for (const { client, roleConfig } of chain) {
      try {
        const result = await client.call(messages, {
          temperature: options.temperature ?? roleConfig.temperature,
          maxTokens: options.maxTokens ?? roleConfig.maxTokens,
          timeoutMs: options.timeoutMs ?? roleConfig.timeoutMs,
          responseFormat: options.responseFormat,
        });
        return result.content;
      } catch (error) {
        failures.push(`${client.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new ModelCallError(`All models failed for role "${role}".\n${failures.join("\n")}`);
  }

  async callVision(
    messages: ChatMessage[],
    options: CallOptions = {},
  ): Promise<{ content: string; modelId: string } | null> {
    const candidates = this.models.filter((model) => model.supports.images !== "no");
    if (candidates.length === 0) return null;
    const failures: string[] = [];
    for (const model of candidates) {
      const client = this.clients.get(model.id);
      if (!client) continue;
      try {
        const result = await client.call(messages, {
          temperature: options.temperature ?? 0.2,
          maxTokens: options.maxTokens ?? 4000,
          timeoutMs: options.timeoutMs ?? 90000,
          responseFormat: options.responseFormat,
        });
        return { content: result.content, modelId: model.id };
      } catch (error) {
        failures.push(`${model.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    log.warn(`Vision review skipped: ${failures.join("; ")}`);
    return null;
  }
}

export function createUsageLogger(runDir: string): (entry: UsageEntry) => void {
  const file = path.join(runDir, "usage.jsonl");
  ensureDir(path.dirname(file));
  return (entry: UsageEntry) => {
    fs.appendFileSync(
      file,
      `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
      "utf8",
    );
  };
}

export function buildRegistry(root = process.cwd(), runDirPath?: string): ModelRegistry {
  const config = loadModelsConfig(root);
  const capabilities = loadCapabilities(root);
  const models = resolveModels(config, capabilities);
  if (models.length === 0) {
    throw new Error(
      "No usable models. Copy .env.example to .env.local and fill in base URL, key, and model names.",
    );
  }
  const roles = config.roles as Partial<Record<RoleName, RoleConfig>>;
  return new ModelRegistry(models, roles, runDirPath ? createUsageLogger(runDirPath) : undefined);
}

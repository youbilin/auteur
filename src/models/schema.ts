import { z } from "zod";

export const RoleNameSchema = z.enum(["director", "critic", "fixer", "vision"]);
export type RoleName = z.infer<typeof RoleNameSchema>;

export const SupportStateSchema = z.enum(["unknown", "yes", "no"]);
export type SupportState = z.infer<typeof SupportStateSchema>;

export const ModelConfigSchema = z
  .object({
    id: z.string().min(1),
    baseUrlEnv: z.string().min(1),
    apiKeyEnv: z.string().min(1),
    modelEnv: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    supports: z
      .object({
        json: SupportStateSchema.default("unknown"),
        images: SupportStateSchema.default("unknown"),
      })
      .default({ json: "unknown", images: "unknown" }),
    priceIn: z.number().min(0).optional(),
    priceOut: z.number().min(0).optional(),
    label: z.string().max(40).optional(),
  })
  .superRefine((model, ctx) => {
    if (!model.modelEnv && !model.model) {
      ctx.addIssue({
        code: "custom",
        path: ["model"],
        message: "Provide modelEnv or model",
      });
    }
  });

export const RoleConfigSchema = z.object({
  chain: z.array(z.string().min(1)).min(1),
  temperature: z.number().min(0).max(2).default(0.3),
  maxTokens: z.number().int().positive().default(8000),
  timeoutMs: z.number().int().positive().default(120000),
  retries: z.number().int().min(0).max(5).default(2),
});

export const RolesConfigSchema = z
  .object({
    director: RoleConfigSchema.optional(),
    critic: RoleConfigSchema.optional(),
    fixer: RoleConfigSchema.optional(),
    vision: RoleConfigSchema.optional(),
  })
  .strict();

export const ModelsConfigSchema = z.object({
  models: z.array(ModelConfigSchema).min(1),
  roles: RolesConfigSchema.optional().default({}),
});

export const CapabilitySchema = z.object({
  json: SupportStateSchema,
  images: SupportStateSchema,
  checkedAt: z.string(),
  models: z.array(z.string()).optional(),
});

export const CapabilitiesFileSchema = z.record(z.string(), CapabilitySchema);

export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type RoleConfig = z.infer<typeof RoleConfigSchema>;
export type ModelsConfig = z.infer<typeof ModelsConfigSchema>;
export type Capability = z.infer<typeof CapabilitySchema>;
export type CapabilitiesFile = z.infer<typeof CapabilitiesFileSchema>;

export interface ResolvedModel {
  config: ModelConfig;
  id: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  supports: { json: SupportState; images: SupportState };
}

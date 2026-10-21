import { z } from "zod";

export const UiBlockSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("header"),
    text: z.string().min(1).max(42),
    sub: z.string().max(70).optional(),
    pill: z.string().max(18).optional(),
  }),
  z.object({
    kind: z.literal("cards"),
    items: z
      .array(
        z.object({
          title: z.string().min(1).max(24),
          body: z.string().max(60).optional(),
          stat: z.string().max(12).optional(),
        }),
      )
      .min(2)
      .max(4),
  }),
  z.object({
    kind: z.literal("chart"),
    label: z.string().min(1).max(16),
    bars: z.array(z.number().min(0).max(1)).min(4).max(12),
    valueLabel: z.string().max(16).optional(),
  }),
  z.object({
    kind: z.literal("list"),
    rows: z.array(z.string().min(1).max(40)).min(2).max(5),
  }),
  z.object({
    kind: z.literal("stat"),
    value: z.string().min(1).max(14),
    label: z.string().min(1).max(24),
    sub: z.string().max(44).optional(),
  }),
  z.object({
    kind: z.literal("quote"),
    text: z.string().min(1).max(120),
    attribution: z.string().max(40).optional(),
  }),
]);

export const FitSchema = z.object({
  headlineScale: z.number().min(0.65).max(1.2).optional(),
  subScale: z.number().min(0.65).max(1.2).optional(),
  uiScale: z.number().min(0.65).max(1.2).optional(),
});

export const CalloutBaseSchema = z.object({
  id: z.string().min(1).max(32).optional(),
  blockIndex: z.number().int().min(0).max(3),
  title: z.string().min(1).max(22),
  body: z.string().max(56).optional(),
  enterMs: z.number().min(0),
  exitMs: z.number().min(0),
});

export const CalloutSchema = CalloutBaseSchema.extend({
  id: z.string().min(1).max(32),
});

export const CameraKeyBaseSchema = z.object({
  atMs: z.number().min(0),
  scale: z.number().min(1).max(1.6),
  focus: z.enum(["screen", "callout", "headline"]),
  calloutId: z.string().optional(),
});

export const CameraKeySchema = CameraKeyBaseSchema;

export const SceneBaseSchema = z.object({
  id: z.string().min(1).max(32).optional(),
  startMs: z.number().min(0).optional(),
  durationMs: z.number().min(2500).max(8000),
  kind: z.literal("device-ui"),
  layout: z.enum(["device", "data", "type", "hook"]).default("device"),
  device: z.object({
    model: z.enum(["laptop", "phone"]),
    theme: z.enum(["light", "dark"]),
  }),
  copy: z.object({
    headline: z.string().min(1).max(40),
    sub: z.string().max(64).optional(),
  }),
  screen: z.object({
    appName: z.string().min(1).max(18),
    blocks: z.array(UiBlockSchema).min(1).max(4),
  }),
  callouts: z.array(CalloutBaseSchema).max(3).default([]),
  camera: z.array(CameraKeySchema).min(1).max(3).default([{ atMs: 0, scale: 1, focus: "screen" }]),
  transitionIn: z
    .object({
      type: z.enum(["fade", "push"]),
      durationMs: z.number().min(100).max(600).default(400),
    })
    .default({ type: "fade", durationMs: 400 }),
  fit: FitSchema.optional(),
});

export const SceneSchema = SceneBaseSchema.extend({
  id: z.string().min(1).max(32),
  startMs: z.number().min(0),
  layout: z.enum(["device", "data", "type", "hook"]),
  callouts: z.array(CalloutSchema).max(3),
  transitionIn: z.object({
    type: z.enum(["fade", "push"]),
    durationMs: z.number().min(100).max(600),
  }),
});

export const BrandSchema = z.object({
  name: z.string().min(1).max(20),
  tagline: z.string().max(48).optional(),
  look: z.enum(["dusk", "paper"]),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  url: z.string().max(40).optional(),
});

export const VideoPlanBaseSchema = z.object({
  version: z.literal(1).default(1),
  id: z.string().min(1).max(40).optional(),
  template: z.literal("product-ui"),
  ratio: z.enum(["16:9", "9:16"]),
  fps: z.literal(30).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationMs: z.number().min(8000).max(15000).optional(),
  brand: BrandSchema,
  scenes: z.array(SceneBaseSchema).min(2).max(4),
});

export const VideoPlanSchema = VideoPlanBaseSchema.extend({
  id: z.string().min(1).max(40),
  fps: z.literal(30),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  durationMs: z.number().min(8000).max(15000),
  scenes: z.array(SceneSchema).min(2).max(4),
}).superRefine((plan, ctx) => {
  const expectedWidth = plan.ratio === "16:9" ? 1920 : 1080;
  const expectedHeight = plan.ratio === "16:9" ? 1080 : 1920;
  if (plan.width !== expectedWidth || plan.height !== expectedHeight) {
    ctx.addIssue({
      code: "custom",
      path: ["width"],
      message: `Expected ${expectedWidth}x${expectedHeight} for ${plan.ratio}`,
    });
  }

  const ids = new Set<string>();
  let cursor = 0;
  for (const [index, scene] of plan.scenes.entries()) {
    if (ids.has(scene.id)) {
      ctx.addIssue({ code: "custom", path: ["scenes", index, "id"], message: "Duplicate scene id" });
    }
    ids.add(scene.id);

    if (scene.startMs !== cursor) {
      ctx.addIssue({
        code: "custom",
        path: ["scenes", index, "startMs"],
        message: `Expected startMs ${cursor}, received ${scene.startMs}`,
      });
    }
    cursor += scene.durationMs;

    const blockCount = scene.screen.blocks.length;
    const calloutIds = new Set<string>();
    for (const [calloutIndex, callout] of scene.callouts.entries()) {
      if (calloutIds.has(callout.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["scenes", index, "callouts", calloutIndex, "id"],
          message: "Duplicate callout id",
        });
      }
      calloutIds.add(callout.id);
      if (callout.blockIndex >= blockCount) {
        ctx.addIssue({
          code: "custom",
          path: ["scenes", index, "callouts", calloutIndex, "blockIndex"],
          message: `blockIndex ${callout.blockIndex} is out of range (${blockCount} blocks)`,
        });
      }
      if (callout.exitMs <= callout.enterMs || callout.exitMs > scene.durationMs) {
        ctx.addIssue({
          code: "custom",
          path: ["scenes", index, "callouts", calloutIndex, "exitMs"],
          message: "Callout exitMs must be after enterMs and within the scene",
        });
      }
    }

    for (const [cameraIndex, camera] of scene.camera.entries()) {
      if (camera.atMs > scene.durationMs) {
        ctx.addIssue({
          code: "custom",
          path: ["scenes", index, "camera", cameraIndex, "atMs"],
          message: "Camera key is after the scene ends",
        });
      }
      if (camera.calloutId && !calloutIds.has(camera.calloutId)) {
        ctx.addIssue({
          code: "custom",
          path: ["scenes", index, "camera", cameraIndex, "calloutId"],
          message: `Unknown calloutId ${camera.calloutId}`,
        });
      }
    }
  }

  if (cursor !== plan.durationMs) {
    ctx.addIssue({
      code: "custom",
      path: ["durationMs"],
      message: `Expected ${cursor}ms from scenes, received ${plan.durationMs}ms`,
    });
  }
});

export const QAIssueSchema = z.object({
  id: z.string(),
  critic: z.enum(["dom", "media", "vlm", "hyperframes"]),
  severity: z.enum(["blocker", "major", "minor"]),
  atMs: z.number().min(0).default(0),
  sceneId: z.string().optional(),
  code: z.string(),
  message: z.string(),
  evidence: z
    .object({
      selector: z.string().optional(),
      frame: z.string().optional(),
      metric: z.number().optional(),
    })
    .optional(),
  fix: z
    .object({
      op: z.enum(["replace", "add", "remove"]),
      path: z.string(),
      value: z.unknown().optional(),
    })
    .optional(),
});

export const QAReportSchema = z.object({
  runId: z.string(),
  createdAt: z.string(),
  score: z.number().min(0).max(100),
  verdict: z.enum(["pass", "fix", "fail"]),
  rubric: z.object({
    dom: z.number(),
    media: z.number(),
    hyperframes: z.number().optional(),
    vlm: z.number().optional(),
  }),
  issues: z.array(QAIssueSchema),
  artifacts: z.object({
    video: z.string(),
    frames: z.array(z.string()).default([]),
    contactSheet: z.string().optional(),
  }),
  notes: z.array(z.string()).default([]),
});

export type UiBlock = z.infer<typeof UiBlockSchema>;
export type Callout = z.infer<typeof CalloutSchema>;
export type CameraKey = z.infer<typeof CameraKeySchema>;
export type SceneSpec = z.infer<typeof SceneSchema>;
export type Brand = z.infer<typeof BrandSchema>;
export type VideoPlan = z.infer<typeof VideoPlanSchema>;
export type VideoPlanDraft = z.infer<typeof VideoPlanBaseSchema>;
export type QAIssue = z.infer<typeof QAIssueSchema>;
export type QAReport = z.infer<typeof QAReportSchema>;

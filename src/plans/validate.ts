import { z } from "zod";
import {
  VideoPlanBaseSchema,
  VideoPlanSchema,
  type Callout,
  type SceneSpec,
  type VideoPlan,
} from "./schema.js";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("\n");
}

/**
 * The model may omit derived fields (ids/startMs/width/duration). Normalize them
 * here so a weaker model only has to get the creative structure right.
 */
export function normalizePlan(input: unknown, opts: { id?: string } = {}): VideoPlan {
  const draft = VideoPlanBaseSchema.parse(input);
  const width = draft.ratio === "16:9" ? 1920 : 1080;
  const height = draft.ratio === "16:9" ? 1080 : 1920;
  const headlines = new Set(
    draft.scenes.map((scene) => scene.copy.headline.trim().toLowerCase()),
  );
  const tagline =
    draft.brand.tagline && !headlines.has(draft.brand.tagline.trim().toLowerCase())
      ? draft.brand.tagline
      : undefined;

  let cursor = 0;
  const scenes: SceneSpec[] = draft.scenes.map((scene, sceneIndex) => {
    const id = scene.id ?? `scene-${sceneIndex + 1}`;
    const startMs = cursor;
    const durationMs = Math.round(scene.durationMs);
    cursor += durationMs;

    const callouts: Callout[] = scene.callouts.map((callout, calloutIndex) => {
      const enterMs = clamp(Math.round(callout.enterMs), 200, Math.max(300, durationMs - 500));
      const exitMs = clamp(
        Math.round(callout.exitMs),
        enterMs + 250,
        Math.max(enterMs + 300, durationMs - 100),
      );
      return {
        id: callout.id ?? `callout-${calloutIndex + 1}`,
        blockIndex: clamp(callout.blockIndex, 0, Math.max(0, scene.screen.blocks.length - 1)),
        title: callout.title,
        body: callout.body,
        enterMs,
        exitMs,
      };
    });

    const camera = scene.camera.map((key) => ({
      ...key,
      atMs: clamp(Math.round(key.atMs), 0, Math.max(0, durationMs - 100)),
    }));

    const blocks = scene.screen.blocks.map((block) => ({ ...block }));
    const first = blocks[0];
    if (
      first?.kind === "header" &&
      first.text.trim().toLowerCase() === scene.screen.appName.trim().toLowerCase()
    ) {
      const suffix = scene.screen.appName.split("/").pop()?.trim();
      first.text = (suffix || "Overview").slice(0, 42);
    }

    return {
      id,
      startMs,
      durationMs,
      kind: "device-ui" as const,
      device: scene.device,
      copy: scene.copy,
      screen: { ...scene.screen, blocks },
      callouts,
      camera,
      transitionIn: scene.transitionIn,
      ...(scene.fit ? { fit: scene.fit } : {}),
    };
  });

  const normalized = {
    version: 1 as const,
    id: opts.id ?? draft.id ?? "plan",
    template: "product-ui" as const,
    ratio: draft.ratio,
    fps: 30 as const,
    width,
    height,
    durationMs: cursor,
    brand: { ...draft.brand, ...(tagline ? { tagline } : { tagline: undefined }) },
    scenes,
  };

  return VideoPlanSchema.parse(normalized);
}

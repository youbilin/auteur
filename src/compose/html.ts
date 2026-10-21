import fs from "node:fs";
import path from "node:path";
import { compositionDir, PROJECT_ROOT, ensureDir, writeJson } from "../core/paths.js";
import type { VideoPlan } from "../plans/schema.js";
import { loadTokens } from "../templates/tokens.js";
import {
  renderProductUi,
  type ProductUiRenderOptions,
  type TemplateAssets,
} from "../templates/product-ui/template.js";

let cachedAssets: TemplateAssets | undefined;

function readBase64(file: string): string {
  return fs.readFileSync(file).toString("base64");
}

function loadAssets(): TemplateAssets {
  if (cachedAssets) return cachedAssets;

  const gsapPath = path.join(PROJECT_ROOT, "node_modules", "gsap", "dist", "gsap.min.js");
  const font400 = path.join(
    PROJECT_ROOT,
    "node_modules",
    "@fontsource",
    "inter",
    "files",
    "inter-latin-400-normal.woff2",
  );
  const font600 = path.join(
    PROJECT_ROOT,
    "node_modules",
    "@fontsource",
    "inter",
    "files",
    "inter-latin-600-normal.woff2",
  );

  for (const file of [gsapPath, font400, font600]) {
    if (!fs.existsSync(file)) {
      throw new Error(`Missing asset ${file}. Run pnpm install.`);
    }
  }

  cachedAssets = {
    gsapJs: fs.readFileSync(gsapPath, "utf8"),
    fonts: [
      { weight: 400, base64: readBase64(font400) },
      { weight: 600, base64: readBase64(font600) },
    ],
  };
  return cachedAssets;
}

export function buildCompositionHtml(
  plan: VideoPlan,
  options: ProductUiRenderOptions = {},
): string {
  return renderProductUi(plan, loadTokens(), loadAssets(), options);
}

export interface CompositionArtifacts {
  dir: string;
  htmlPath: string;
}

export function writeCompositionAt(
  dir: string,
  plan: VideoPlan,
  options: ProductUiRenderOptions = {},
): CompositionArtifacts {
  ensureDir(dir);
  const htmlPath = path.join(dir, "index.html");
  const assets = loadAssets();
  fs.writeFileSync(htmlPath, renderProductUi(plan, loadTokens(), assets, options), "utf8");
  fs.writeFileSync(path.join(dir, "gsap.min.js"), assets.gsapJs, "utf8");

  writeJson(path.join(dir, "hyperframes.json"), {
    $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
    registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
    paths: {
      blocks: "compositions",
      components: "compositions/components",
      assets: "assets",
    },
    media: { autoProxy: false },
  });

  writeJson(path.join(dir, "package.json"), {
    name: `auteur-${plan.id}`,
    private: true,
    type: "module",
  });

  writeJson(path.join(dir, "meta.json"), {
    id: plan.id,
    name: plan.brand.name,
    width: plan.width,
    height: plan.height,
    fps: plan.fps,
    durationMs: plan.durationMs,
  });

  return { dir, htmlPath };
}

export function writeComposition(
  runId: string,
  plan: VideoPlan,
  options: ProductUiRenderOptions = {},
): CompositionArtifacts {
  return writeCompositionAt(compositionDir(runId), plan, options);
}

import path from "node:path";
import { readJson } from "../core/paths.js";

export interface LookTokens {
  bg: string;
  bgAlt: string;
  surface: string;
  surface2: string;
  text: string;
  muted: string;
  line: string;
  grid: string;
  accent: string;
  accentInk: string;
}

export interface Tokens {
  looks: {
    dusk: LookTokens;
    paper: LookTokens;
  };
  type: {
    display: number;
    h1: number;
    h2: number;
    title: number;
    body: number;
    small: number;
    micro: number;
  };
  space: Record<string, number>;
  radius: Record<string, number>;
  motion: {
    fast: number;
    base: number;
    slow: number;
    scene: number;
    camera: number;
    easings: string[];
  };
}

export function loadTokens(root = process.cwd()): Tokens {
  return readJson<Tokens>(path.join(root, "config", "tokens.base.json"));
}

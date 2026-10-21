import fs from "node:fs";
import path from "node:path";

const from = path.join("src", "models", "prompts");
const to = path.join("dist", "models", "prompts");
fs.mkdirSync(to, { recursive: true });
for (const file of fs.readdirSync(from)) {
  if (file.endsWith(".md")) {
    fs.copyFileSync(path.join(from, file), path.join(to, file));
  }
}
console.log(`Copied prompts to ${to}`);

# Example plans

- `plan-arc.json` — the 12-second Arc demo used in the README. A normal, clean plan.
- `plan-layouts.json` — 4 scenes exercising `device`, `data`, `type`, and `hook` layouts.
- `plan-zh.json` — 2 Chinese scenes (`lang="zh-CN"`), rendered with the local CJK font stack.
- `plan-overflow.json` — a deliberately broken fixture for the fix-loop demo. The first headline is size 1.20 and overflows by 45px; `auteur fix` reduces it to 1.08 and re-renders to 100/100.

Render any of them directly:

```bash
pnpm run render -- --plan examples/plan-arc.json
pnpm run render -- --plan examples/plan-layouts.json
pnpm run render -- --plan examples/plan-zh.json
pnpm run render -- --plan examples/plan-overflow.json
```

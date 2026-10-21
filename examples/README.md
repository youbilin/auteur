# Example plans

- `plan-arc.json` — the 12-second Arc demo used in the README. A normal, clean plan.
- `plan-overflow.json` — a deliberately broken fixture for the fix-loop demo. The first headline is size 1.20 and overflows by 45px; `auteur fix` reduces it to 1.08 and re-renders to 100/100.

Render either directly:

```bash
pnpm run render -- --plan examples/plan-arc.json
pnpm run render -- --plan examples/plan-overflow.json
```

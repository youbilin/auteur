# Fix loop evidence

Fixture: `examples/plan-overflow.json`

- Before: 95/100 with a 45px headline overflow (`dom_overflow`).
- Patch: replace `scenes.0.fit` with `{ "headlineScale": 1.08 }`.
- After: 100/100, 0 issues.
- The original and fixed renders are kept separately in `runs/overflow-demo/out/video.mp4` and `video.fixed.mp4` (runs/ is gitignored).

Reproduce:

```bash
pnpm run render -- --plan examples/plan-overflow.json
pnpm run qa -- --run overflow-demo
pnpm run fix -- --run overflow-demo
```

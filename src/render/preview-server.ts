import fs from "node:fs";
import http from "node:http";
import path from "node:path";

export interface PreviewServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

export async function startPreviewServer(
  compositionDir: string,
  preferredPort = 4321,
): Promise<PreviewServer> {
  const htmlPath = path.join(compositionDir, "index.html");
  if (!fs.existsSync(htmlPath)) {
    throw new Error(`Missing composition HTML: ${htmlPath}`);
  }

  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url ?? "/", "http://localhost");
    if (parsedUrl.pathname === "/" || parsedUrl.pathname === "/index.html") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(fs.readFileSync(htmlPath));
      return;
    }
    if (parsedUrl.pathname === "/gsap.min.js") {
      const gsap = path.join(compositionDir, "gsap.min.js");
      if (fs.existsSync(gsap)) {
        res.writeHead(200, {
          "Content-Type": "text/javascript; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(fs.readFileSync(gsap));
        return;
      }
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  });

  const port = await new Promise<number>((resolve, reject) => {
    const tryListen = (candidate: number, attemptsLeft: number) => {
      server.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE" && attemptsLeft > 0) {
          tryListen(candidate + 1, attemptsLeft - 1);
          return;
        }
        reject(error);
      });
      server.listen(candidate, "127.0.0.1", () => resolve(candidate));
    };
    tryListen(preferredPort, 20);
  });

  return {
    url: `http://127.0.0.1:${port}/?preview=1`,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

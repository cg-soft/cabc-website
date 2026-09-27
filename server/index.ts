import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "node:http";
import path from "node:path";
import { ApiError, getStorage, type IStorage } from "./storage";
import { SchemaCompatibilityError } from "./database";

// Only fixed operational text is logged. No bodies, query strings, identifiers,
// Authorization headers, passwords, invitation codes, or member details.
export function log(message: string, source = "express") {
  console.log(`[${source}] ${message}`);
}

export async function createApplication(options: { storage?: IStorage; apiOnly?: boolean } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.disable("etag");
  app.set("trust proxy", false);
  const httpServer = createServer(app);
  httpServer.requestTimeout = 30000;
  httpServer.headersTimeout = 15000;
  httpServer.keepAliveTimeout = 5000;

  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
    if (/^\/api(?:\/|$)/i.test(req.path)) {
      // Opaque preview frames have Origin: null. Bearer tokens are explicit,
      // never ambient cookies; wildcard CORS without credentials is intentional.
      res.set({
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "600",
        "Cache-Control": "no-store, private",
        Pragma: "no-cache",
      });
      if (req.method === "OPTIONS") {
        res.status(204).end();
        return;
      }
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(decodeURIComponent(req.path)).replace(/\\/g, "/");
    } catch {
      res.status(400).json({ message: "Invalid path." });
      return;
    }
    const dependencyPrefix = `/@fs${path.resolve("node_modules").replace(/\\/g, "/")}/`;
    const devDependency =
      process.env.NODE_ENV !== "production" &&
      decoded.startsWith(dependencyPrefix) &&
      !decoded.split("/").includes("..");
    if (
      (decoded.startsWith("/@fs") && !devDependency) ||
      /(?:^|\/)(?:private|data|server|shared|tests|\.git|\.env[^/]*)(?:\/|$)/i.test(decoded) ||
      /\.(?:sqlite|db)(?:-wal|-shm|-journal)?(?:\/|$)/i.test(decoded) ||
      /(?:^|\/)owner-setup\.txt(?:\/|$)/i.test(decoded)
    ) {
      res.status(404).json({ message: "Not found." });
      return;
    }
    next();
  });
  app.use("/api", (req, res, next) => {
    if (["POST", "PATCH", "PUT"].includes(req.method) && !req.is("application/json")) {
      res.status(415).json({ message: "Send a JSON request body." });
      return;
    }
    next();
  });
  // Bound JSON before validation, reject compressed bombs, never retain rawBody.
  app.use(express.json({ limit: "160kb", strict: true, inflate: false }));
  await registerRoutes(httpServer, app, options.storage ?? getStorage());

  if (!options.apiOnly) {
    if (process.env.NODE_ENV === "production") serveStatic(app);
    else {
      const { setupVite } = await import("./vite");
      await setupVite(httpServer, app);
    }
  } else app.use((_req, res) => res.status(404).json({ message: "Not found." }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (err instanceof ApiError) {
      res.status(err.status).json({ message: err.message });
      return;
    }
    const status = (err as { status?: number })?.status;
    if (status === 413) {
      res.status(413).json({ message: "The request is too large." });
      return;
    }
    if (status === 400) {
      res.status(400).json({ message: "Invalid JSON request." });
      return;
    }
    if (status === 415) {
      res.status(415).json({ message: "Unsupported request encoding." });
      return;
    }
    // Never print err: SQLite/parser exceptions can include private input data.
    console.error("[express] Request failed with an internal error.");
    res.status(500).json({ message: "Something went wrong. Please try again." });
  });
  return { app, httpServer };
}

if (process.env.NODE_ENV !== "test") {
  createApplication({ apiOnly: process.env.API_ONLY === "1" })
    .then(({ httpServer }) => {
      const port = Number(process.env.PORT || 5000);
      httpServer.listen({ port, host: "0.0.0.0" }, () => log(`Serving on port ${port}`));
      for (const signal of ["SIGTERM", "SIGINT"] as const)
        process.once(signal, () => {
          httpServer.close(() => {
            getStorage().close();
            process.exit(0);
          });
          setTimeout(() => process.exit(0), 5000).unref();
        });
    })
    .catch((error) => {
      console.error(
        error instanceof SchemaCompatibilityError
          ? `[express] ${error.message}`
          : "[express] Startup failed. Check private storage and server configuration.",
      );
      process.exitCode = 1;
    });
}

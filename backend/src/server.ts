import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { authMiddleware } from "./middleware/auth.js";
import { buildAutoRouter } from "./autoRouter.js";

const PORT = Number(process.env.PORT) || 3001;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5177";

const app = express();

// ─── Security ─────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    callback(null, origin || true);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-api-key", "x-9r-cli-token"],
}));

// ─── Body Parsing ─────────────────────────────────────────────────────────────
app.use(cookieParser());
app.use(express.json({ limit: "128mb" }));
app.use(express.urlencoded({ extended: true, limit: "128mb" }));

// ─── Health Check (no auth) ────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", version: "0.5.0", ts: Date.now() });
});

// ─── Static frontend (9router-dist) ───────────────────────────────────────────
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = process.env.DIST_DIR
  ? path.resolve(process.env.DIST_DIR)
  : path.resolve(__dirname, "../../frontend/dist");
app.use(express.static(DIST_DIR, { index: false, etag: true, lastModified: true, setHeaders: (res, filePath) => {
  if (filePath.endsWith(".html")) {
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
  } else {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  }
} }));
// SPA fallback: serve index.html for non-API, non-v1 routes
app.get("/", (_req, res) => {
  res.setHeader("Cache-Control", "no-cache, must-revalidate");
  res.sendFile(path.join(DIST_DIR, "index.html"));
});

// ─── Auth Middleware ───────────────────────────────────────────────────────────
// Only enforce auth on API/LLM paths — SPA routes are handled by static serving
app.use((req, res, next) => {
  const p = req.path;
  if (!p.startsWith("/api") && !p.startsWith("/v1") && !p.startsWith("/v1beta")) {
    return next();
  }
  authMiddleware(req, res, next);
});

// ─── Auto-mount all routes ────────────────────────────────────────────────────
async function start() {
  const apiRouter = await buildAutoRouter();
  app.use("/api", (req, res, next) => {
    console.log("API request:", req.method, req.url, req.originalUrl);
    apiRouter(req, res, next);
  });

  // LLM proxy remaps: /v1/* → /api/v1/*
  app.use("/v1", (req, res, next) => {
    req.url = "/v1" + req.url;
    apiRouter(req, res, next);
  });
  app.use("/v1beta", (req, res, next) => {
    req.url = "/v1beta" + req.url;
    apiRouter(req, res, next);
  });

  // ─── SPA Fallback + 404 ────────────────────────────────────────────────────
  // Non-API, non-asset GET requests that reach here are SPA routes (e.g. /dashboard)
  app.use((req, res) => {
    if (req.method === "GET" && !req.path.startsWith("/api") && !req.path.startsWith("/v1") && !req.path.startsWith("/v1beta") && !path.extname(req.path)) {
      return res.sendFile(path.join(DIST_DIR, "index.html"));
    }
    res.status(404).json({ error: "Not found" });
  });

  // ─── Error Handler ─────────────────────────────────────────────────────────
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[server] unhandled error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  });

  app.listen(PORT, () => {
    console.log(`\n🚀 9Router Backend v2 running on http://localhost:${PORT}`);
    console.log(`   Frontend origin: ${FRONTEND_ORIGIN}`);
    console.log(`   Environment: ${process.env.NODE_ENV || "development"}\n`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

export { app };


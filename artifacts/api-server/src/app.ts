import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { sandraApiContract, sandraChatPolicy } from "./middlewares/sandraPolicy";

declare const __SANDRA_BUILD_SHA__: string;

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "24mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/api/sandra/build", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ok: true,
    sha: typeof __SANDRA_BUILD_SHA__ === "string" ? __SANDRA_BUILD_SHA__ : "unknown",
  });
});

app.use(
  "/api",
  (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  },
  sandraApiContract,
  sandraChatPolicy,
  router,
);

export default app;

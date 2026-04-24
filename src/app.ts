import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import "express-async-errors";

import routes from "./routes";
import { errorMiddleware } from "./middlewares/error.middleware";
import { logger } from "./config/logger";

const app = express();

/**
 * TRUST PROXY (important kalau deploy di cloud / nginx)
 */
app.set("trust proxy", 1);

/**
 * GLOBAL MIDDLEWARES
 */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * SECURITY
 */
app.use(helmet());

app.use(
  cors({
    origin: "*", // nanti bisa diganti whitelist
  }),
);

/**
 * RATE LIMIT (anti brute force)
 */
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 menit
    max: 100, // max 100 request
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

/**
 * HEALTH CHECK (penting di production)
 */
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    uptime: process.uptime(),
  });
});

/**
 * ROUTES
 */
app.use("/api", routes);

/**
 * 404 HANDLER
 */
app.use((req, res) => {
  res.status(404).json({
    message: "Route not found",
  });
});

/**
 * ERROR HANDLER (HARUS PALING BAWAH)
 */
app.use(errorMiddleware);

export default app;

import express from "express";
import cors from "cors";
import helmet from "helmet";
import "express-async-errors";

import { env } from "./config/env";
import { corsOptions } from "./config/cors.config";
import routes from "./routes";
import { errorMiddleware } from "./middlewares/error.middleware";
import { notFoundMiddleware } from "./middlewares/not-found.middleware";
import { globalLimiter } from "./config/rate-limit.config";

const app = express();

/**
 * TRUST PROXY (important kalau deploy di cloud / nginx)
 */
app.set("trust proxy", env.TRUST_PROXY);

/**
 * GLOBAL MIDDLEWARES
 */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * SECURITY
 */
app.use(helmet());

app.use(cors(corsOptions));

/**
 * RATE LIMIT (anti brute force)
 */
app.use(globalLimiter);

/**
 * ROUTES
 */
app.use("/api", routes);

/**
 * 404 HANDLER
 */
app.use(notFoundMiddleware);

/**
 * ERROR HANDLER (HARUS PALING BAWAH)
 */
app.use(errorMiddleware);

export default app;

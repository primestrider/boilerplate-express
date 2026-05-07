import { rateLimit } from "express-rate-limit";
import { StatusCodes } from "http-status-codes";

import { responseFormatter } from "../libs/response";

const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  limit: 6000, // Limit each IP to 6000 requests per window.
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (_req, res) => {
    res
      .status(StatusCodes.TOO_MANY_REQUESTS)
      .json(
        responseFormatter.error(
          "Too many requests, please try again later.",
          "TOO_MANY_REQUESTS",
        ),
      );
  },
  validate: { trustProxy: false },
});

export { globalLimiter };

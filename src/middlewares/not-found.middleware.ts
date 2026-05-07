import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

import { responseFormatter } from "../libs/response";

export const notFoundMiddleware = (req: Request, res: Response) => {
  res
    .status(StatusCodes.NOT_FOUND)
    .json(responseFormatter.error(`Route ${req.originalUrl} not found`));
};

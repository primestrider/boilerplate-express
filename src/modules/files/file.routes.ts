import { Router, type RequestHandler } from "express";
import multer from "multer";

import { validate } from "../../shared/middlewares/validate.middleware";
import type { FileController } from "./file.controller";
import { fileIdParamsSchema, listFilesQuerySchema } from "./file.schema";

type FileRouterOptions = {
  authenticate: RequestHandler;
  idempotency: RequestHandler;
  maxFileBytes: number;
};

/**
 * File routes. Every route requires authentication. Uploads accept one file
 * of at most `maxFileBytes`, held in memory while its type is checked; for
 * large files switch to streaming storage (multer disk storage or S3).
 */
export const createFileRouter = (
  fileController: FileController,
  { authenticate, idempotency, maxFileBytes }: FileRouterOptions,
) => {
  const router = Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxFileBytes, files: 1, fields: 5, parts: 6 },
    // Browsers send UTF-8 file names without declaring a charset.
    defParamCharset: "utf8",
  }).single("file");

  router.use(authenticate);

  // Idempotency comes after multer: the file is part of the fingerprint.
  router.post("/", upload, idempotency, fileController.upload);
  router.get(
    "/",
    validate({ query: listFilesQuerySchema }),
    fileController.findAll,
  );
  router.get(
    "/:id",
    validate({ params: fileIdParamsSchema }),
    fileController.findById,
  );
  router.get(
    "/:id/content",
    validate({ params: fileIdParamsSchema }),
    fileController.download,
  );
  router.delete(
    "/:id",
    validate({ params: fileIdParamsSchema }),
    fileController.delete,
  );

  return router;
};

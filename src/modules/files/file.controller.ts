import { pipeline } from "node:stream/promises";
import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";

import { HttpError } from "../../shared/errors/http-error";
import { sendPaginated, sendSuccess } from "../../shared/http/response";
import { getAuth } from "../authentication/authenticate.middleware";
import type { StoredFile } from "./file.repository";
import type {
  FileIdParamsDto,
  FileResponse,
  ListFilesQueryDto,
} from "./file.schema";
import type { FileService } from "./file.service";

const toFileResponse = (file: StoredFile): FileResponse => ({
  id: file.id,
  ownerId: file.ownerId,
  originalName: file.originalName,
  mimeType: file.mimeType,
  size: file.size,
  createdAt: file.createdAt.toISOString(),
});

export class FileController {
  constructor(private readonly fileService: FileService) {}

  /**
   * POST /files (multipart/form-data, field "file")
   */
  upload: RequestHandler = async (req, res) => {
    if (!req.file) {
      throw HttpError.badRequest('Send the file as multipart field "file"', {
        errorCode: "FILE_REQUIRED",
      });
    }

    const file = await this.fileService.upload(getAuth(res).userId, {
      originalName: req.file.originalname,
      data: req.file.buffer,
    });

    sendSuccess(
      res,
      StatusCodes.CREATED,
      toFileResponse(file),
      "File uploaded successfully",
    );
  };

  /**
   * GET /files (the caller's files)
   */
  findAll: RequestHandler<
    Record<string, never>,
    unknown,
    unknown,
    ListFilesQueryDto
  > = async (req, res) => {
    const files = await this.fileService.findAll(
      getAuth(res).userId,
      req.query,
    );

    sendPaginated(
      res,
      StatusCodes.OK,
      files.data.map(toFileResponse),
      files.meta,
      "Files retrieved successfully",
    );
  };

  /**
   * GET /files/:id
   */
  findById: RequestHandler<FileIdParamsDto> = async (req, res) => {
    const file = await this.fileService.findById(getAuth(res), req.params.id);

    sendSuccess(res, StatusCodes.OK, toFileResponse(file));
  };

  /**
   * GET /files/:id/content: the raw bytes, as a download.
   */
  download: RequestHandler<FileIdParamsDto> = async (req, res) => {
    const { file, content } = await this.fileService.open(
      getAuth(res),
      req.params.id,
    );

    res.status(StatusCodes.OK);
    res.type(file.mimeType);
    res.set("Content-Length", String(file.size));
    // "attachment" keeps browsers from rendering the file inline on our
    // origin; res.attachment() encodes the name safely.
    res.attachment(file.originalName);

    await pipeline(content, res);
  };

  /**
   * DELETE /files/:id
   */
  delete: RequestHandler<FileIdParamsDto> = async (req, res) => {
    await this.fileService.delete(getAuth(res), req.params.id);

    sendSuccess(res, StatusCodes.OK, undefined, "File deleted successfully");
  };
}

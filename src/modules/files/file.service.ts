import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { StatusCodes } from "http-status-codes";

import { logger } from "../../config/logger";
import { HttpError } from "../../shared/errors/http-error";
import {
  paginate,
  type Paginated,
  type PaginationQuery,
} from "../../shared/http/pagination";
import type { FileStorage } from "../../shared/storage/file-storage";
import type { AuditService } from "../audit/audit.service";
import type { AuthContext } from "../authentication/authenticate.middleware";
import { ALLOWED_MIME_TYPES, detectMimeType } from "./file-type";
import type { FileRepository, StoredFile } from "./file.repository";

export type UploadInput = {
  originalName: string;
  data: Buffer;
};

const MAX_NAME_LENGTH = 255;

/**
 * Upload, listing, download and deletion of files.
 *
 * A file is visible to its owner and to admins. For anyone else it does not
 * exist (404), so ids cannot be probed.
 */
export class FileService {
  constructor(
    private readonly repository: FileRepository,
    private readonly storage: FileStorage,
    private readonly auditService: AuditService,
  ) {}

  async upload(ownerId: string, input: UploadInput): Promise<StoredFile> {
    const mimeType = detectMimeType(input.data);

    if (!mimeType) {
      throw new HttpError(
        `Unsupported file type. Allowed: ${ALLOWED_MIME_TYPES.join(", ")}`,
        {
          statusCode: StatusCodes.UNSUPPORTED_MEDIA_TYPE,
          errorCode: "UNSUPPORTED_FILE_TYPE",
        },
      );
    }

    const storageKey = randomUUID();
    await this.storage.save(storageKey, input.data);

    let file: StoredFile;
    try {
      file = await this.repository.create({
        ownerId,
        originalName: input.originalName.slice(0, MAX_NAME_LENGTH),
        mimeType,
        size: input.data.length,
        storageKey,
      });
    } catch (error) {
      // Do not leave orphaned bytes behind when the metadata insert fails.
      await this.storage.delete(storageKey);
      throw error;
    }

    await this.auditService.record({
      action: "file.uploaded",
      entityType: "file",
      entityId: file.id,
      metadata: { mimeType, size: file.size },
    });

    return file;
  }

  async findAll(
    ownerId: string,
    query: PaginationQuery,
  ): Promise<Paginated<StoredFile>> {
    const { files, total } = await this.repository.findByOwner(ownerId, query);
    return paginate(files, total, query);
  }

  async findById(auth: AuthContext, id: string): Promise<StoredFile> {
    const file = await this.repository.findById(id);

    if (!file || (file.ownerId !== auth.userId && auth.role !== "admin")) {
      throw HttpError.notFound("File not found", {
        errorCode: "FILE_NOT_FOUND",
      });
    }

    return file;
  }

  /** The file's metadata and a stream of its bytes. */
  async open(
    auth: AuthContext,
    id: string,
  ): Promise<{ file: StoredFile; content: Readable }> {
    const file = await this.findById(auth, id);
    return { file, content: await this.storage.read(file.storageKey) };
  }

  async delete(auth: AuthContext, id: string): Promise<void> {
    const file = await this.findById(auth, id);

    await this.repository.delete(file.id);

    // The row is gone, so a failure here only leaves unreachable bytes.
    await this.storage.delete(file.storageKey).catch((error: unknown) => {
      logger.error("Failed to delete stored file", {
        storageKey: file.storageKey,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    await this.auditService.record({
      action: "file.deleted",
      entityType: "file",
      entityId: file.id,
    });
  }
}

export type ResponseType = "success" | "error" | "paginated";

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

type Message = string | Record<string, any> | null;


type FormatterInput<T = unknown, M = unknown> = {
  type: ResponseType;
  data?: T | null;
  message?: Message;
  meta?: M;
  errorCode?: string;
};

export type ResponseDTO<T = unknown, M = unknown> = {
  success: boolean;
  message: Message;
  data: T | null;
  meta?: M;
  errorCode?: string;
};


const baseFormatter = <T = unknown, M = unknown>(
  input: FormatterInput<T, M>
): ResponseDTO<T, M> => {
  const { type, data = null, message = null, meta, errorCode } = input;

  switch (type) {
    case "success":
      return {
        success: true,
        message,
        data,
      };

    case "error":
      return {
        success: false,
        message,
        data,
        ...(errorCode !== undefined ? { errorCode } : {}),
      };

    case "paginated":
      return {
        success: true,
        message,
        data,
        ...(meta !== undefined ? { meta } : {}),
      };

    default:
      return {
        success: false,
        message: "Invalid response type",
        data: null,
      };
  }
};

export const responseFormatter = Object.assign(baseFormatter, {
  success: <T = unknown>(
    data: T,
    message: Message
  ): ResponseDTO<T> => ({
    success: true,
    message,
    data,
  }),

  error: (
    message: string | object,
    errorCode?: string,
    data: unknown = null
  ): ResponseDTO => ({
    success: false,
    message,
    data,
    ...(errorCode !== undefined ? { errorCode } : {}),
  }),

  paginated: <T = unknown>(
    data: T,
    meta: PaginationMeta,
    message: string | object | null = null
  ): ResponseDTO<T, PaginationMeta> => ({
    success: true,
    message,
    data,
    meta,
  }),
});

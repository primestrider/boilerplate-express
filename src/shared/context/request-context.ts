import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request values that code deep in the call stack needs (audit log,
 * logging) without threading them through every function signature.
 */
export type RequestContext = {
  requestId: string;
  ip: string | undefined;
  /** Set by `authenticate` once the caller is known. */
  userId?: string;
};

const storage = new AsyncLocalStorage<RequestContext>();

/** Runs `fn` (the rest of the request) with the given context. */
export const runWithRequestContext = (
  context: RequestContext,
  fn: () => void,
) => storage.run(context, fn);

/** The current request's context, or undefined outside a request (CLI, jobs). */
export const getRequestContext = (): RequestContext | undefined =>
  storage.getStore();

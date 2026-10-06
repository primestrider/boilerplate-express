# 12. Background Jobs and Email

## Goals

By the end of this chapter you will understand:

- Why some work should not happen inside the HTTP request.
- What a **queue**, a **producer**, a **job** and a **worker** are.
- How `src/jobs/jobs.ts` and `src/worker.ts` implement jobs with **BullMQ**.
- Retries, exponential backoff, and why job handlers must be safe to run twice.
- How emails are sent with **nodemailer**, and how development works without a mail server.
- What happens to jobs when Redis is unavailable.

## Core concepts

### Why not do everything in the request?

When a user registers, we want to send a welcome email. Sending an email means talking to a mail server over the network: it can take a second or more, and it can fail (the mail server is slow, down, or rate-limits us).

If the API sent the email **inside** the request:

- The user waits longer for the "registered" response.
- If the mail server is down, the registration fails, even though creating the account worked.
- There is no automatic retry.

Think of a restaurant: the waiter (the API) takes your order and immediately says "your order is placed". The waiter does not stand in the kitchen cooking it. The order goes on a **ticket rail** (the queue), and the cooks (workers) pick tickets up as they can. If a dish fails, the cook makes it again.

### The vocabulary

- **Job**: one unit of work with a name and some data, e.g. `send-email` with `{ to, subject, text }`.
- **Queue**: an ordered list of jobs waiting to be done. Here it lives in Redis, so it survives restarts and is shared by all processes.
- **Producer**: the code that **adds** jobs to the queue (the API).
- **Worker**: a separate process that **takes** jobs from the queue and runs them.
- **Retry with backoff**: if a job fails, try again later, waiting longer each time (1 s, 2 s, 4 s, 8 s, ...). Waiting longer and longer is called **exponential backoff**; it gives a struggling service time to recover instead of hammering it.

```
┌─────────┐  add("send-email", {...})  ┌──────────────┐   take job   ┌──────────┐
│   API   │ ─────────────────────────▶ │ Queue (Redis)│ ───────────▶ │  Worker  │ ──▶ SMTP server
│(producer)│                            │  jobs:wait   │ ◀─────────── │          │
└─────────┘                             └──────────────┘  done/failed └──────────┘
```

### At-least-once delivery

Queues like BullMQ guarantee that a job runs **at least once**, not **exactly once**. A worker might send the email and then crash before it marks the job as done; the job is then retried, and the email may be sent twice.

So job handlers must be **idempotent** (chapter 11): running them twice should be harmless or have the same effect. For a notification email a rare duplicate is acceptable; for something like "charge the customer" you would record a unique id and skip work that was already done.

## In this boilerplate

### Declaring jobs with types: `src/jobs/jobs.ts`

```ts
export type JobPayloads = {
  "send-email": MailMessage;
};

export type JobName = keyof JobPayloads;
```

`JobPayloads` is the single list of every job and its data. TypeScript uses it to check every call: `jobQueue.add("send-email", { to: "a@b.com" })` would not compile, because `subject` and `text` are missing. Adding a new job means adding one line here.

The comment above it gives an important rule: payloads travel through Redis as JSON, so keep them **small and serializable**: ids and plain values, not whole database entities (which could also be stale by the time the job runs).

### Handlers

```ts
export const createJobHandlers = ({
  mailer,
}: {
  mailer: Mailer;
}): JobHandlers => ({
  "send-email": (message) => mailer.send(message),
});
```

A **handler** is the function that does the work of a job. The same handlers are used by the worker and by the inline queue (below), so the behavior is identical in both modes. `runHandler(handlers, name, data)` is a tiny helper that calls the handler for a job name.

### The `JobQueue` interface and its two implementations

```ts
export interface JobQueue {
  /** Schedules a job; resolves once it is queued, not when it has run. */
  add<N extends JobName>(name: N, data: JobPayloads[N]): Promise<void>;
  close(): Promise<void>;
}
```

| Implementation   | When               | What `add` does                                                  |
| ---------------- | ------------------ | ---------------------------------------------------------------- |
| `BullJobQueue`   | `REDIS_URL` is set | Stores the job in Redis; the worker process runs it with retries |
| `InlineJobQueue` | No `REDIS_URL`     | Runs the handler in the API process, right away, no retries      |

`src/server.ts` picks one:

```ts
const jobQueue: JobQueue = redis
  ? new BullJobQueue(redis)
  : new InlineJobQueue(
      createJobHandlers({ mailer: new NodemailerMailer(env) }),
    );
```

Tests use a third one, `RecordingJobQueue` (in `src/test/create-test-app.ts`), which only records jobs so tests can assert "a welcome email was queued" (chapter 16).

### `BullJobQueue`

```ts
this.queue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});
```

- `attempts: 5`: a job is tried up to 5 times.
- `backoff: exponential, 1000 ms`: wait about 1 s, 2 s, 4 s, 8 s between attempts.
- `removeOnComplete: 1000` / `removeOnFail: 5000`: keep only the latest 1000 finished and 5000 failed jobs, so Redis does not fill up forever. Failed jobs are kept longer, so you can inspect what went wrong.

The `add` method has one extra guard:

```ts
async add<N extends JobName>(name: N, data: JobPayloads[N]): Promise<void> {
  // BullMQ waits for the connection without a timeout; fail fast instead
  // of stalling the request while Redis is down.
  if (this.connection.status !== "ready") {
    throw new Error(`Redis is not ready (${this.connection.status})`);
  }

  await this.queue.add(name, data);
}
```

This came from a real test: with Redis stopped, `POST /register` hung for 60 seconds. BullMQ waits for the Redis connection to become `ready` **without any timeout**. The guard turns that into an immediate error, which the caller handles (next section).

### `InlineJobQueue`

```ts
async add<N extends JobName>(name: N, data: JobPayloads[N]): Promise<void> {
  // Not awaited: like a real queue, the caller does not wait for the job.
  const job = runHandler(this.handlers, name, data)
    .catch((error: unknown) => {
      logger.error("Job failed", { job: name, error: ... });
    })
    .finally(() => this.running.delete(job));

  this.running.add(job);
}
```

It starts the handler but does **not** wait for it, so the request returns just as fast as with a real queue. It keeps the running promises in a `Set` so that `close()` can wait for them during shutdown. There is no persistence and no retry: fine for development, not for production.

### Best-effort notifications: `notify()`

The authentication service queues emails through one helper (`src/modules/authentication/authentication.service.ts`):

```ts
/**
 * Queues a notification email. Best effort: the action it reports already
 * succeeded, so a queue outage is logged instead of failing the request.
 */
private async notify(message: MailMessage) {
  try {
    await this.jobQueue.add("send-email", message);
  } catch (error) {
    logger.error("Failed to queue email", {
      subject: message.subject,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
```

It is called after `register` (welcome email) and after `changePassword` (password changed notice). The account was already created / the password already changed; returning a 500 because the email could not be queued would be misleading and would make clients retry an action that already happened. So the failure is logged and the request succeeds. This is the "skip + log" choice from the fail open / fail closed discussion in chapter 10.

### The worker process: `src/worker.ts`

The worker is a separate program (`npm run worker` in development, `node dist/worker.js` after a build). It refuses to start without Redis:

```ts
if (!env.REDIS_URL) {
  logger.error("REDIS_URL is required to run the worker");
  process.exit(1);
}
```

Then it creates a BullMQ `Worker` on the same queue name:

```ts
const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    if (!(job.name in handlers)) {
      throw new Error(`Unknown job: ${job.name}`);
    }

    await runHandler(handlers, job.name as JobName, job.data);
  },
  {
    // BullMQ workers block on Redis and need unlimited retries per command.
    connection: new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }),
    concurrency: 5,
  },
);
```

- If the handler throws, BullMQ marks the attempt as failed and schedules a retry (up to 5 attempts).
- `concurrency: 5`: one worker process runs up to 5 jobs at the same time.
- A worker waits on Redis with **blocking** commands ("give me the next job, I'll wait"), so BullMQ requires `maxRetriesPerRequest: null`. This is the opposite of the API's fail-fast client: a worker _should_ patiently wait for Redis to come back; an API request should not.
- You can start several worker processes; BullMQ hands each job to only one of them.

It logs every completed and failed job, and shuts down gracefully:

```ts
const shutdown = async (signal: string) => {
  logger.info(`${signal} received. Finishing active jobs...`);
  // Waits for running jobs; unfinished ones are retried by another worker.
  await worker.close();
  process.exit(0);
};
```

### Sending email: `src/shared/mail/mailer.ts`

`NodemailerMailer` implements a one-method interface, `Mailer.send(message)`.

```ts
this.transporter = config.SMTP_HOST
  ? nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      // Port 465 is implicit TLS; other ports upgrade with STARTTLS.
      secure: config.SMTP_PORT === 465,
      ...(config.SMTP_USER && config.SMTP_PASS
        ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASS } }
        : {}),
    })
  : nodemailer.createTransport({ jsonTransport: true });
```

- **SMTP** is the protocol for sending email. You need a server (your provider's, or a service like Mailgun, SES, Postmark).
- **Port 465** speaks TLS (encryption) from the first byte ("implicit TLS"). **Port 587** starts unencrypted and upgrades with **STARTTLS**. That is why `secure` is `true` only for 465.
- Without `SMTP_HOST`, nodemailer's **JSON transport** builds the message but sends it nowhere, and the mailer logs it instead. You can develop and test without any mail server.

```ts
if (this.logOnly) {
  logger.info("Email not sent (SMTP_HOST is not set)", {
    to: message.to,
    subject: message.subject,
    text: message.text,
  });
  return;
}
```

### Email templates

Templates live next to the module that sends them, in `src/modules/authentication/authentication.emails.ts`:

```ts
export const welcomeEmail = (
  user: Pick<User, "name" | "email">,
): MailMessage => ({
  to: user.email,
  subject: "Welcome!",
  text: `Hi ${user.name},\n\nYour account has been created. You can now sign in with ${user.email}.\n`,
});
```

They are plain functions that return a `MailMessage`. Plain text works in every email client; add an `html` field when you need a design.

## Step by step: a welcome email

1. `POST /api/v1/authentication/register` creates the user (chapter 7).
2. `AuthenticationService.register` calls `notify(welcomeEmail(user))`.
3. `BullJobQueue.add("send-email", message)` stores the job in Redis (`bull:jobs:...`).
4. The API answers `201` immediately.
5. The worker receives the job and calls `mailer.send(message)`.
6. Success → `Job completed` is logged. Failure → retry after ~1 s, ~2 s, ... up to 5 attempts, then the job stays in the failed list.

## Try it yourself

Terminal 1 (API) and terminal 2 (worker), with `REDIS_URL` set in `.env`:

```bash
npm run dev
npm run worker
```

Register a user:

```bash
curl -s -X POST http://localhost:3000/api/v1/authentication/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Jobs Demo","email":"jobs@example.com","password":"correct horse battery"}'
```

The worker terminal shows (one JSON object per line, shortened here):

```json
{"level":"info","message":"Worker started","queue":"jobs","service":"boilerplate-express", ...}
{"level":"info","message":"Email not sent (SMTP_HOST is not set)","to":"jobs@example.com","subject":"Welcome!","text":"Hi Jobs Demo,\n\nYour account has been created. ...", ...}
{"level":"info","message":"Job completed","job":"send-email","jobId":"1", ...}
```

Now stop the worker and register another user: the API still answers `201`, and the job waits in Redis:

```bash
docker compose exec redis redis-cli LLEN bull:jobs:wait     # 1
```

Start the worker again and watch it process the waiting job.

Without `REDIS_URL`, you do not need the worker: the same "Email not sent" line appears in the API's own log (inline queue).

## Common mistakes

- **Doing slow or unreliable work inside the request.** Users wait, and failures of a side task fail the main action.
- **Putting whole objects in job payloads.** They are serialized and may be stale when the job runs; pass ids or the minimum data needed.
- **Assuming exactly-once execution.** Jobs can run twice; make handlers idempotent.
- **Retrying forever or without backoff.** That hammers a failing service. Limit attempts and back off.
- **Failing the user's request because a notification could not be queued.** Decide what is essential and what is best-effort.
- **Waiting forever on a dead connection in the API.** Guard calls that have no built-in timeout.

## Summary

- Slow, unreliable side work (email) goes into a **queue** and is processed by a **worker**.
- `JobPayloads` types every job; handlers are shared by the worker and the inline queue.
- BullMQ retries failed jobs 5 times with exponential backoff; delivery is at-least-once.
- Emails are best-effort: `notify()` logs queue failures instead of failing the request.
- Without SMTP, emails are logged; without Redis, jobs run inline in the API.

Next: [13. File uploads](13-file-uploads.md).

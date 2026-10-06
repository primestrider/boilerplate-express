import nodemailer, { type Transporter } from "nodemailer";

import type { Env } from "../../config/env";
import { logger } from "../../config/logger";

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/**
 * Sends email through nodemailer. Without SMTP_HOST the message is rendered
 * by the JSON transport and logged, so development needs no mail server.
 */
export class NodemailerMailer implements Mailer {
  private readonly transporter: Transporter;
  private readonly logOnly: boolean;
  private readonly from: string;

  constructor(
    config: Pick<
      Env,
      "SMTP_HOST" | "SMTP_PORT" | "SMTP_USER" | "SMTP_PASS" | "MAIL_FROM"
    >,
  ) {
    this.logOnly = !config.SMTP_HOST;
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
    this.from = config.MAIL_FROM;
  }

  async send(message: MailMessage): Promise<void> {
    const info = await this.transporter.sendMail({
      from: this.from,
      ...message,
    });

    if (this.logOnly) {
      logger.info("Email not sent (SMTP_HOST is not set)", {
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
      return;
    }

    logger.info("Email sent", { messageId: info.messageId });
  }
}

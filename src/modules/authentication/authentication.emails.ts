import type { MailMessage } from "../../shared/mail/mailer";
import type { User } from "../users/user.entity";

/**
 * Email templates of the authentication module. Plain text keeps them
 * readable in every client; add `html` when a design is needed.
 */
export const welcomeEmail = (
  user: Pick<User, "name" | "email">,
): MailMessage => ({
  to: user.email,
  subject: "Welcome!",
  text: `Hi ${user.name},\n\nYour account has been created. You can now sign in with ${user.email}.\n`,
});

export const passwordChangedEmail = (
  user: Pick<User, "name" | "email">,
): MailMessage => ({
  to: user.email,
  subject: "Your password was changed",
  text: `Hi ${user.name},\n\nThe password of your account was just changed and every session was signed out. If this was not you, contact support right away.\n`,
});

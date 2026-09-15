import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config/env';
import { logger } from '../utils/logger';

/**
 * Outbound mail.
 *
 * SMTP rather than a provider SDK: every provider speaks it, swapping one for
 * another is a config change, and local development can point at a sink
 * container instead of reaching the internet.
 */

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Captures messages instead of sending them.
 *
 * Used by the test suite, and as the dev fallback when no SMTP host is
 * configured — a developer running `npm run dev` should not have their
 * password-reset request fail because they have no mail server, but they also
 * must not silently believe mail is going out in production. `config.smtpHost`
 * is required when NODE_ENV=production, so this branch cannot be reached there.
 */
export interface CapturedMail extends Mail {
  sentAt: Date;
}

const outbox: CapturedMail[] = [];

export const getOutbox = (): readonly CapturedMail[] => outbox;
export const clearOutbox = () => outbox.splice(0, outbox.length);

let transporter: Transporter | null = null;

const getTransporter = (): Transporter | null => {
  if (!config.smtpHost) return null;

  transporter ??= nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    // Local sinks accept anything and have no credentials; passing an empty
    // auth object makes nodemailer attempt AUTH and fail against them.
    ...(config.smtpUser ? { auth: { user: config.smtpUser, pass: config.smtpPassword } } : {}),
  });

  return transporter;
};

/**
 * Sends one message.
 *
 * Never throws to the caller. A failed notification must not turn into a failed
 * request — a password reset whose confirmation email bounced has still reset
 * the password, and surfacing the SMTP error would also tell an anonymous
 * caller whether the address exists.
 */
export const sendMail = async (mail: Mail): Promise<boolean> => {
  const transport = getTransporter();

  if (!transport) {
    outbox.push({ ...mail, sentAt: new Date() });
    logger.info(`[mail:captured] to=${mail.to} subject="${mail.subject}"`);
    return true;
  }

  try {
    await transport.sendMail({
      from: config.mailFrom,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    logger.info(`Mail sent to ${mail.to}: ${mail.subject}`);
    return true;
  } catch (error) {
    logger.error(`Mail delivery failed to ${mail.to}: ${(error as Error).message}`);
    return false;
  }
};

// ── Templates ───────────────────────────────────────────────────────────────
//
// Inline styles and a table-free layout: mail clients strip <style> blocks and
// disagree about almost everything else. Every message is sent with a plain
// text alternative, which is also what a screen reader and a spam filter read.

const shell = (heading: string, body: string) => `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
            max-width:520px;margin:0 auto;padding:32px 24px;color:#111827">
  <h1 style="font-size:20px;font-weight:700;margin:0 0 16px">${heading}</h1>
  ${body}
  <p style="margin-top:32px;font-size:12px;color:#6b7280">
    2carvn — sent automatically, please do not reply.
  </p>
</div>`;

const button = (href: string, label: string) => `
  <p style="margin:24px 0">
    <a href="${href}"
       style="display:inline-block;background:#2d6cdf;color:#ffffff;text-decoration:none;
              padding:12px 20px;border-radius:10px;font-weight:600">${label}</a>
  </p>`;

export const passwordResetEmail = (params: {
  name: string;
  resetUrl: string;
  ttlMinutes: number;
}): Omit<Mail, 'to'> => ({
  subject: 'Reset your 2carvn password',
  html: shell(
    'Reset your password',
    `<p style="margin:0;font-size:15px;line-height:1.6">Hello ${escapeHtml(params.name)},</p>
     <p style="font-size:15px;line-height:1.6">
       We received a request to reset your 2carvn password. This link works once and
       expires in ${params.ttlMinutes} minutes.
     </p>
     ${button(params.resetUrl, 'Choose a new password')}
     <p style="font-size:13px;line-height:1.6;color:#6b7280">
       If you did not ask for this, you can ignore this email — your password will not change.
     </p>
     <p style="font-size:12px;color:#6b7280;word-break:break-all">${params.resetUrl}</p>`
  ),
  text: [
    `Hello ${params.name},`,
    '',
    'We received a request to reset your 2carvn password.',
    `This link works once and expires in ${params.ttlMinutes} minutes:`,
    '',
    params.resetUrl,
    '',
    'If you did not ask for this, you can ignore this email — your password will not change.',
  ].join('\n'),
});

export const passwordChangedEmail = (params: { name: string }): Omit<Mail, 'to'> => ({
  subject: 'Your 2carvn password was changed',
  html: shell(
    'Your password was changed',
    `<p style="margin:0;font-size:15px;line-height:1.6">Hello ${escapeHtml(params.name)},</p>
     <p style="font-size:15px;line-height:1.6">
       Your 2carvn password has just been changed and every signed-in device has been
       signed out.
     </p>
     <p style="font-size:15px;line-height:1.6">
       <strong>If this wasn't you, contact your school administrator immediately.</strong>
     </p>`
  ),
  // Sent even though the user just did this deliberately: it is the only signal
  // they get if someone else completed a reset against their account.
  text: [
    `Hello ${params.name},`,
    '',
    'Your 2carvn password has just been changed and every signed-in device has been signed out.',
    '',
    "If this wasn't you, contact your school administrator immediately.",
  ].join('\n'),
});

/** Names come from user input and land inside an HTML document. */
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );

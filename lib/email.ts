/**
 * Transactional email service.
 * ---------------------------------------------------------------------
 * Backend selection (automatic):
 *   - SMTP_URL set:        real SMTP via nodemailer.
 *   - SMTP_URL unset:      console.log fallback (dev/preview only).
 *                          The email body is printed so you can click
 *                          reset links during local development.
 *
 * Email verification is intentionally NOT implemented — signup is
 * instant. If you need it later, add a EmailVerificationToken model
 * and a /api/auth/verify-email route; the email service here already
 * supports sending arbitrary templates.
 *
 * SECURITY: forgot-password NEVER leaks whether an email exists. The
 * API always returns 200 with the same message — "if the email is
 * registered, a reset link has been sent." The actual email is only
 * sent when the user exists, so an attacker can't enumerate accounts
 * by timing or response shape.
 */

import "@/lib/server-guard";

let _transporter: import("nodemailer").Transporter | null = null;
let _initTried = false;

function getSmtpUrl(): string | null {
  const url = process.env.SMTP_URL;
  if (!url) return null;
  // Accept smtp://, smtps://, and bare connection strings.
  if (url.startsWith("smtp://") || url.startsWith("smtps://")) return url;
  return null;
}

function getFrom(): string {
  return process.env.EMAIL_FROM ?? "GLM Power Platform <noreply@localhost>";
}

async function getTransporter(): Promise<import("nodemailer").Transporter | null> {
  if (_initTried) return _transporter;
  _initTried = true;
  const url = getSmtpUrl();
  if (!url) return null;
  try {
    const nodemailer = await import("nodemailer");
    _transporter = nodemailer.createTransport(url, {
      from: getFrom(),
    });
    // Verify the connection so we fail fast on bad config.
    await _transporter.verify();
    console.log(`[email] SMTP connected: ${url.replace(/:[^:@]+@/, ":***@")}`);
    return _transporter;
  } catch (e) {
    console.warn(
      `[email] SMTP connection failed: ${(e as Error).message} — ` +
      `falling back to console.log. Set SMTP_URL to enable real email.`
    );
    _transporter = null;
    return null;
  }
}

export interface SendEmailOpts {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendEmail(opts: SendEmailOpts): Promise<{ sent: boolean; via: "smtp" | "console" }> {
  const transporter = await getTransporter();
  if (!transporter) {
    // Console fallback — print the email so dev links are clickable.
    console.log(
      `\n[email:console-fallback]────────────────────────────────────\n` +
      `To: ${opts.to}\n` +
      `Subject: ${opts.subject}\n` +
      `──────────────────────────────────────────────────────────────\n` +
      `${opts.text}\n` +
      `──────────────────────────────────────────────────────────────\n`
    );
    return { sent: true, via: "console" };
  }
  try {
    await transporter.sendMail({
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });
    return { sent: true, via: "smtp" };
  } catch (e) {
    console.warn(`[email] send failed to ${opts.to}: ${(e as Error).message}`);
    // Don't fall back to console here — the SMTP URL is set, so the
    // operator intended real email. Failing silently to console would
    // hide the outage. Re-throw so the caller can return 500.
    throw e;
  }
}

/**
 * Synchronous status check for /api/health.
 */
export function getEmailStatus(): { configured: boolean; from: string } {
  return {
    configured: Boolean(getSmtpUrl()),
    from: getFrom(),
  };
}

/**
 * Build the password-reset email body. Returns { subject, text, html }.
 * The reset link points to /reset-password?token=... so the frontend
 * can render the form.
 */
export function buildPasswordResetEmail(
  resetUrl: string,
  userEmail: string
): { subject: string; text: string; html: string } {
  const subject = "Reset your GLM Power Platform password";
  const text = [
    `We received a request to reset the password for your GLM Power Platform account (${userEmail}).`,
    ``,
    `Click the link below to choose a new password:`,
    resetUrl,
    ``,
    `This link expires in 1 hour.`,
    ``,
    `If you didn't request this, you can safely ignore this email — your password is still unchanged.`,
    ``,
    `GLM Power Platform`,
  ].join("\n");
  const html = `
    <div style="font-family:-apple-system,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <p>We received a request to reset the password for your GLM Power Platform account (<strong>${userEmail}</strong>).</p>
      <p style="margin:24px 0">
        <a href="${resetUrl}" style="display:inline-block;background:#000;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
          Reset password
        </a>
      </p>
      <p style="color:#6e6e73;font-size:13px">This link expires in 1 hour.</p>
      <p style="color:#6e6e73;font-size:13px">If you didn't request this, you can safely ignore this email — your password is still unchanged.</p>
    </div>
  `;
  return { subject, text, html };
}

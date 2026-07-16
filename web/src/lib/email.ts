const RESEND_API_KEY = process.env.RESEND_API_KEY;

export interface SendEmailInput {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail({ to, from, subject, html, text }: SendEmailInput): Promise<void> {
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, html, text }),
  });

  if (!res.ok) {
    throw new Error(`Resend send to ${to} failed: ${res.status} ${await res.text()}`);
  }
}

// Absolute URL -- email clients fetch images over the network, never
// relative to the email's own (nonexistent) location. This is a real
// static asset in public/ (NOT the Next.js app/icon.svg favicon route,
// which isn't meant for hotlinking and isn't a raster image email
// clients can reliably render) so the URL is stable across deploys.
const LOGO_URL = "https://jslnode.jaysynclab.com/email-logo.png";

// Shared visual shell so every email from this project looks like one
// system -- dark terminal aesthetic matching the site, inline styles only
// (email clients don't load external/embedded stylesheets reliably).
export function renderEmailShell(opts: { eyebrow: string; heading: string; bodyHtml: string }): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#050607;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#050607;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#0c0f11;border:1px solid #1c2228;border-radius:10px;overflow:hidden;">
            <tr>
              <td style="padding:24px 28px 0;">
                <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                  <td style="padding-right:10px;"><img src="${LOGO_URL}" width="28" height="28" alt="JaySync-Lab" style="display:block;border-radius:6px;" /></td>
                  <td style="color:#e4e7eb;font-size:13px;font-weight:600;letter-spacing:0.02em;">JaySync-Lab Playground</td>
                </tr></table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px 20px;">
                <p style="margin:0 0 6px;color:#4ee3a8;font-size:11px;letter-spacing:0.25em;text-transform:uppercase;">${opts.eyebrow}</p>
                <h1 style="margin:0;color:#e4e7eb;font-size:20px;font-weight:600;">${opts.heading}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 28px;color:#a1a1aa;font-size:14px;line-height:1.6;">
                ${opts.bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px;border-top:1px solid #1c2228;color:#52525b;font-size:11px;">
                JaySync-Lab Playground &middot; <a href="https://jslnode.jaysynclab.com" style="color:#52525b;">jslnode.jaysynclab.com</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

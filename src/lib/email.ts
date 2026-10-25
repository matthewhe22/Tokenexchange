// Transactional email through Resend's HTTP API. Without RESEND_API_KEY, emails are logged
// instead of sent and email verification is not required (handy for local development).

export function emailEnabled(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export async function sendEmail(msg: { to: string; subject: string; text: string }): Promise<void> {
  if (!emailEnabled()) {
    console.log(`[email disabled] to=${msg.to} subject=${msg.subject}\n${msg.text}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM ?? "Tenon <onboarding@resend.dev>",
      to: [msg.to],
      subject: msg.subject,
      text: msg.text,
    }),
  });
  if (!res.ok) throw new Error(`email send failed: ${res.status} ${await res.text()}`);
}

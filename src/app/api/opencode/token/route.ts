import crypto from "node:crypto";
import { getSession } from "auth/server";

/**
 * Mints a short-lived, HMAC-signed identity token for the OpenCode "Code
 * runtime". The browser fetches this, then streams directly from the OpenCode
 * bridge (bypassing Vercel's function-duration limit). The bridge verifies the
 * signature and reads identity from the token — the browser can't forge it.
 *
 * Token format (matches the bridge's _verify_user_token):
 *   base64url(JSON payload) "." base64url(HMAC-SHA256(secret, msg))
 *   payload = { uid, email, role, name, exp }   // exp = unix seconds
 */
const b64url = (buf: Buffer) =>
  buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export async function POST() {
  const secret = process.env.OPENCODE_JWT_SECRET;
  const runUrl = process.env.OPENCODE_RUN_URL;
  if (!secret || !runUrl) {
    return Response.json(
      { error: "Code runtime not configured" },
      { status: 501 },
    );
  }

  const session = await getSession();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = {
    uid: session.user.id,
    email: session.user.email || "",
    role: (session.user as { role?: string }).role || "",
    name: session.user.name || "",
    exp: Math.floor(Date.now() / 1000) + 300, // 5 minutes
  };
  const msg = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(crypto.createHmac("sha256", secret).update(msg).digest());

  return Response.json({
    token: `${msg}.${sig}`,
    url: runUrl.replace(/\/$/, ""),
  });
}

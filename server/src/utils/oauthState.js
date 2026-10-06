import crypto from "crypto";

/**
 * Signs an OAuth state object using HMAC-SHA256 with SESSION_SECRET.
 */
export function signOAuthState(data) {
  const secret = process.env.SESSION_SECRET || "logitrust_session_secret_2026";
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

/**
 * Verifies and parses a signed OAuth state parameter.
 * Returns null if the signature is invalid or tampered with.
 */
export function verifyOAuthState(stateStr) {
  if (!stateStr || typeof stateStr !== "string" || !stateStr.includes(".")) {
    return null;
  }
  const secret = process.env.SESSION_SECRET || "logitrust_session_secret_2026";
  const [payload, signature] = stateStr.split(".");
  const expectedSignature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSignature);

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

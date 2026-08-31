const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

const LANGUAGES = new Set(["pt-BR", "en-US", "es"]);
const EMAIL_PATTERN = /^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function singleLine(value, maxLength) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

function multiLine(value, maxLength) {
  return typeof value === "string"
    ? value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, maxLength)
    : "";
}

function isSameOrigin(request) {
  return request.headers.get("Origin") === new URL(request.url).origin;
}

function hasValidLengths(body) {
  return typeof body.name === "string" && body.name.length <= 100
    && typeof body.email === "string" && body.email.length <= 254
    && typeof body.address === "string" && body.address.length <= 500
    && typeof body.details === "string" && body.details.length <= 2_000
    && (body.website === undefined || (typeof body.website === "string" && body.website.length <= 200))
    && typeof body.turnstileToken === "string" && body.turnstileToken.length <= 2_048;
}

async function fetchWithTimeout(url, options, timeout = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(request, maxBytes) {
  if (!request.body) throw new Error("Missing body");

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new RangeError("Request too large");
    }
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return JSON.parse(text);
}

async function verifyTurnstile(request, token, secret) {
  const response = await fetchWithTimeout("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret,
      response: token,
      remoteip: request.headers.get("CF-Connecting-IP") || undefined,
      idempotency_key: crypto.randomUUID(),
    }),
  });

  if (!response.ok) return false;

  const result = await response.json();
  const hostname = new URL(request.url).hostname;
  return result.success === true && result.action === "order-contact" && result.hostname === hostname;
}

export async function onRequestGet({ env }) {
  if (!env.TURNSTILE_SITE_KEY) return json({ error: "Form unavailable" }, 503);
  return json({ siteKey: env.TURNSTILE_SITE_KEY });
}

export async function onRequestPost({ request, env }) {
  if (!isSameOrigin(request)) return json({ error: "Invalid request origin" }, 403);
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    return json({ error: "Unsupported content type" }, 415);
  }

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 12_000) return json({ error: "Request too large" }, 413);

  if (!env.TURNSTILE_SECRET_KEY || !env.CF_ACCOUNT_ID || !env.CF_EMAIL_API_TOKEN || !env.ORDER_EMAIL || !env.ORDER_FROM) {
    return json({ error: "Form unavailable" }, 503);
  }

  let body;
  try {
    body = await readJson(request, 12_000);
  } catch (error) {
    return json({ error: error instanceof RangeError ? "Request too large" : "Invalid request" }, error instanceof RangeError ? 413 : 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body) || !hasValidLengths(body)) {
    return json({ error: "Invalid request" }, 400);
  }
  if (singleLine(body.website, 200)) return json({ success: true }, 202);

  const name = singleLine(body.name, 100);
  const email = singleLine(body.email, 254).toLowerCase();
  const address = multiLine(body.address, 500);
  const details = multiLine(body.details, 2_000);
  const language = LANGUAGES.has(body.language) ? body.language : "en-US";
  const turnstileToken = singleLine(body.turnstileToken, 2_048);
  const startedAt = Number(body.startedAt);
  const elapsed = Date.now() - startedAt;

  if (name.length < 2 || !EMAIL_PATTERN.test(email) || address.length < 5 || details.length < 10) {
    return json({ error: "Invalid form data" }, 400);
  }
  if (!turnstileToken || !Number.isFinite(startedAt) || elapsed < 2_000) {
    return json({ error: "Verification failed" }, 400);
  }

  let verified = false;
  try {
    verified = await verifyTurnstile(request, turnstileToken, env.TURNSTILE_SECRET_KEY);
  } catch {
    return json({ error: "Verification unavailable" }, 503);
  }
  if (!verified) return json({ error: "Verification failed" }, 400);

  const message = [
    "New store order enquiry",
    "",
    `Language: ${language}`,
    `Name: ${name}`,
    `Customer email: ${email}`,
    "",
    "Delivery address:",
    address,
    "",
    "Item details:",
    details,
  ].join("\n");

  let emailResponse;
  try {
    emailResponse = await fetchWithTimeout(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CF_ACCOUNT_ID)}/email/sending/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CF_EMAIL_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: env.ORDER_EMAIL,
        from: { address: env.ORDER_FROM, name: "Resiliente Store" },
        reply_to: { address: email, name },
        subject: `Store order enquiry — ${name}`,
        text: message,
      }),
    });
  } catch {
    return json({ error: "Email service unavailable" }, 503);
  }

  let emailResult;
  try {
    emailResult = await emailResponse.json();
  } catch {
    return json({ error: "Invalid email service response" }, 502);
  }

  if (!emailResponse.ok || emailResult.success !== true) {
    return json({ error: "Unable to send message" }, emailResponse.status === 429 ? 429 : 502);
  }

  const accepted = [...(emailResult.result?.delivered || []), ...(emailResult.result?.queued || [])];
  if (!accepted.includes(env.ORDER_EMAIL)) return json({ error: "Unable to send message" }, 502);
  return json({ success: true }, 202);
}

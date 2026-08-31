const PORTUGUESE_COUNTRIES = new Set([
  "AO",
  "BR",
  "CV",
  "GW",
  "MO",
  "MZ",
  "PT",
  "ST",
  "TL",
]);

const SPANISH_COUNTRIES = new Set([
  "AR",
  "BO",
  "CL",
  "CO",
  "CR",
  "CU",
  "DO",
  "EC",
  "ES",
  "GQ",
  "GT",
  "HN",
  "MX",
  "NI",
  "PA",
  "PE",
  "PR",
  "PY",
  "SV",
  "UY",
  "VE",
]);

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; base-uri 'self'; connect-src 'self' https://challenges.cloudflare.com; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; form-action 'self'; frame-ancestors 'none'; frame-src https://challenges.cloudflare.com; img-src 'self' data: https://pub-5e39d369540947e9b3c3f5a6a5dc72a5.r2.dev; media-src https://pub-5e39d369540947e9b3c3f5a6a5dc72a5.r2.dev; object-src 'none'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; upgrade-insecure-requests",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function secure(response) {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) secured.headers.set(name, value);
  return secured;
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  if (url.pathname !== "/" || (request.method !== "GET" && request.method !== "HEAD")) {
    return secure(await context.next());
  }

  const country = request.cf?.country?.toUpperCase() ?? "";

  if (PORTUGUESE_COUNTRIES.has(country)) {
    return secure(await context.next());
  }

  url.pathname = SPANISH_COUNTRIES.has(country) ? "/index-es.html" : "/index-en.html";

  return secure(new Response(null, {
    status: 302,
    headers: {
      "Cache-Control": "private, no-store",
      Location: url.toString(),
      Vary: "CF-IPCountry",
    },
  }));
}

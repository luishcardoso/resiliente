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

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  if (url.pathname !== "/" || (request.method !== "GET" && request.method !== "HEAD")) {
    return context.next();
  }

  const country = request.cf?.country?.toUpperCase() ?? "";

  if (PORTUGUESE_COUNTRIES.has(country)) {
    return context.next();
  }

  url.pathname = SPANISH_COUNTRIES.has(country) ? "/index-es.html" : "/index-en.html";

  return new Response(null, {
    status: 302,
    headers: {
      "Cache-Control": "private, no-store",
      Location: url.toString(),
      Vary: "CF-IPCountry",
    },
  });
}

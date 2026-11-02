const API_BASE_URL =
  process.env.API_BASE_URL || "https://booking-api-ashy.vercel.app";
const API_KEY = process.env.API_KEY || "";

export async function backendFetch(
  endpoint: string,
  options: RequestInit = {}
) {
  const url = `${API_BASE_URL.replace(/\/+$/, "")}/${endpoint.replace(/^\/+/, "")}`;
  const headers = new Headers(options.headers || {});
  headers.set("X-API-Key", API_KEY);
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  const res = await fetch(url, {
    ...options,
    headers,
    cache: "no-store",
  });

  const contentType = res.headers.get("content-type") || "";
  let data: any = null;
  if (contentType.includes("application/json")) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  } else {
    data = await res.text();
  }

  return {
    status: res.status,
    ok: res.ok,
    headers: res.headers,
    data,
  };
}


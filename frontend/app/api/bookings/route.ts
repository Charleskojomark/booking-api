import { NextRequest, NextResponse } from "next/server";
import { backendFetch } from "@/lib/api";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const idempotencyKey =
      req.headers.get("Idempotency-Key") ||
      `web-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    const { status, data, headers } = await backendFetch("bookings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(body),
    });

    const responseInit: ResponseInit = { status };
    const retryAfter = headers.get("retry-after");
    if (retryAfter) {
      responseInit.headers = { "Retry-After": retryAfter };
    }

    return NextResponse.json(data, responseInit);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to create booking" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const email = searchParams.get("email");
    const limit = searchParams.get("limit");
    const cursor = searchParams.get("cursor");

    if (!email) {
      return NextResponse.json(
        { error: "email query parameter is required" },
        { status: 400 }
      );
    }

    const params = new URLSearchParams();
    params.set("email", email);
    if (limit) params.set("limit", limit);
    if (cursor) params.set("cursor", cursor);

    const { status, data } = await backendFetch(`bookings?${params.toString()}`, {
      method: "GET",
    });

    return NextResponse.json(data, { status });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to retrieve bookings" },
      { status: 500 }
    );
  }
}


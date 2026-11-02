import { NextRequest, NextResponse } from "next/server";
import { backendFetch } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const provider = searchParams.get("provider");
    const query = provider ? `?provider=${encodeURIComponent(provider)}` : "";

    const { status, data } = await backendFetch(`slots${query}`, {
      method: "GET",
    });

    return NextResponse.json(data, { status });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to fetch slots from backend" },
      { status: 500 }
    );
  }
}


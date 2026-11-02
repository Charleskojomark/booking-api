import { NextRequest, NextResponse } from "next/server";
import { backendFetch } from "@/lib/api";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { status, data } = await backendFetch(`bookings/${id}`, {
      method: "GET",
    });

    return NextResponse.json(data, { status });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to retrieve booking" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { status, data } = await backendFetch(`bookings/${id}`, {
      method: "DELETE",
    });

    return NextResponse.json(data, { status });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to cancel booking" },
      { status: 500 }
    );
  }
}


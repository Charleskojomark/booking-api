import { NextRequest, NextResponse } from "next/server";
import { backendFetch } from "@/lib/api";

const DEFAULT_SAMPLE_SLOTS = [
  {
    id: "s1",
    provider: "Dr Ade",
    start: "2026-12-10T09:00:00Z",
    end: "2026-12-10T09:30:00Z",
  },
  {
    id: "s2",
    provider: "Dr Ade",
    start: "2026-12-10T09:30:00Z",
    end: "2026-12-10T10:00:00Z",
  },
  {
    id: "s3",
    provider: "Dr Ade",
    start: "2026-12-10T10:00:00Z",
    end: "2026-12-10T10:30:00Z",
  },
  {
    id: "s4",
    provider: "Dr Bello",
    start: "2026-12-10T09:00:00Z",
    end: "2026-12-10T09:30:00Z",
  },
  {
    id: "s5",
    provider: "Dr Bello",
    start: "2026-12-10T11:00:00Z",
    end: "2026-12-10T11:30:00Z",
  },
  {
    id: "s6",
    provider: "Dr Bello",
    start: "2026-12-10T14:00:00Z",
    end: "2026-12-10T14:30:00Z",
  },
  {
    id: "s7",
    provider: "Dr Okafor",
    start: "2026-12-11T09:00:00Z",
    end: "2026-12-11T09:30:00Z",
  },
  {
    id: "s8",
    provider: "Dr Okafor",
    start: "2026-12-11T10:00:00Z",
    end: "2026-12-11T10:30:00Z",
  },
];

export async function POST(req: NextRequest) {
  try {
    let slots = DEFAULT_SAMPLE_SLOTS;
    try {
      const body = await req.json();
      if (body && Array.isArray(body.slots) && body.slots.length > 0) {
        slots = body.slots;
      }
    } catch {
      // Use defaults if empty body
    }

    const { status, data } = await backendFetch("reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slots }),
    });

    return NextResponse.json(data, { status });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to reset clinic slots" },
      { status: 500 }
    );
  }
}


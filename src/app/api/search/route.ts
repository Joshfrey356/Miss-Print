import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { globalSearch } from "@/lib/search";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return NextResponse.json({ results: await globalSearch(user, q) });
}

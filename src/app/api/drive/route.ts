import { NextResponse } from "next/server";
import { getSession } from "auth/server";
import {
  encodePath,
  displaySeg,
  filesStorageFromEnv,
  keySeg,
} from "lib/files/storage";

/**
 * File Explorer ("Drive") backend — DIRECT Supabase connector.
 *
 * Deliberate two-door architecture over the SAME per-account bucket:
 *   - UI buttons  -> this route -> Supabase directly (fast; no MCP hop)
 *   - Chat/agent  -> the DataPilot files-mcp tools   (list_dir / upload_document
 *     / move_file / move_dir / make_dir / delete_dir / delete_file)
 * Behaviour parity is a hard requirement: this route mirrors the MCP tools'
 * semantics 1:1 — same E64 non-ASCII key encoding (lib/files/storage.ts
 * keySeg/displaySeg byte-match the Python _key_seg/_display_seg), same
 * one-level lazy listing, same upload validation, same response shapes.
 * /api/drive/parity verifies the alignment on demand.
 *
 * Account scope = the session user id — the SAME prefix the MCP sees via
 * injected identity, so both doors always show identical files.
 */

// Upload rules — keep in sync with the MCP's UPLOAD_ALLOWED_EXT / UPLOAD_MAX_MB.
const ALLOWED_EXT = (process.env.UPLOAD_ALLOWED_EXT || "pdf,csv,md,txt")
  .split(",")
  .map((e) => e.trim().toLowerCase().replace(/^\./, ""))
  .filter(Boolean);
const MAX_MB = Number(process.env.UPLOAD_MAX_MB || "20");
const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  csv: "text/csv",
  md: "text/markdown",
  txt: "text/plain",
};

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

function safeName(name: string): string {
  // strip directory components; drop control chars; keep unicode
  const base = (name || "").split(/[/\\]/).pop() || "";
  const clean = Array.from(base)
    .filter((c) => c.charCodeAt(0) >= 0x20)
    .join("")
    .trim();
  return clean || `file-${Date.now()}`;
}

async function account(): Promise<string | null> {
  const session = await getSession();
  return session?.user?.id ?? null;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  return NextResponse.json({ error: message }, { status: 500 });
}

// GET /api/drive?path=<display path>  -> list one folder level (lazy)
export async function GET(request: Request) {
  const acct = await account();
  if (!acct) return unauthorized();
  const path = new URL(request.url).searchParams.get("path") ?? "";
  try {
    return NextResponse.json(await filesStorageFromEnv().listDir(acct, path));
  } catch (error) {
    return fail(error);
  }
}

// POST /api/drive  (multipart: file+category?  OR  mkdir)
export async function POST(request: Request) {
  const acct = await account();
  if (!acct) return unauthorized();
  try {
    const form = await request.formData();
    const storage = filesStorageFromEnv();

    // mkdir: create an (empty) folder at a display path.
    const mkdir = ((form.get("mkdir") as string) || "").trim();
    if (mkdir) {
      if (mkdir.includes("..")) {
        return NextResponse.json(
          { ok: false, error: "invalid_path", reason: "路徑不合法" },
          { status: 422 },
        );
      }
      await storage.makeDir(acct, mkdir.replace(/^\/+|\/+$/g, ""));
      return NextResponse.json({ ok: true, path: mkdir }, { status: 201 });
    }

    // upload — same validation as the MCP upload_document tool.
    const file = form.get("file");
    const category = ((form.get("category") as string) || "")
      .trim()
      .replace(/^\/+|\/+$/g, "");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No file (field 'file')" },
        { status: 400 },
      );
    }
    const name = safeName(file.name);
    const ext = extOf(name);
    if (!ALLOWED_EXT.includes(ext)) {
      return NextResponse.json(
        {
          ok: false,
          error: "unsupported_format",
          reason: `格式不支援（僅限 ${ALLOWED_EXT.join("/")}）`,
        },
        { status: 422 },
      );
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > MAX_MB * 1024 * 1024) {
      return NextResponse.json(
        {
          ok: false,
          error: "too_large",
          reason: `超過大小上限 ${MAX_MB} MB`,
        },
        { status: 422 },
      );
    }
    const contentType =
      file.type || EXT_MIME[ext] || "application/octet-stream";
    const key = (category ? `${encodePath(category)}/` : "") + keySeg(name);
    await storage.upload(acct, key, bytes, contentType);
    return NextResponse.json(
      {
        ok: true,
        path: key,
        name,
        size: bytes.byteLength,
        category,
        content_type: contentType,
      },
      { status: 201 },
    );
  } catch (error) {
    return fail(error);
  }
}

// DELETE /api/drive?path=<key>[&type=folder]
//   file   (default): path = raw storage key from listDir files[].path
//   folder (type=folder): path = display path from listDir folders[].path
export async function DELETE(request: Request) {
  const acct = await account();
  if (!acct) return unauthorized();
  const url = new URL(request.url);
  const path = url.searchParams.get("path");
  if (!path)
    return NextResponse.json({ error: "Missing path" }, { status: 400 });
  if (path.includes(".."))
    return NextResponse.json(
      { ok: false, error: "invalid_path", reason: "路徑不合法" },
      { status: 422 },
    );
  try {
    const storage = filesStorageFromEnv();
    if (url.searchParams.get("type") === "folder") {
      const deleted = await storage.deleteDir(acct, path);
      return NextResponse.json({ ok: true, deleted });
    }
    await storage.remove(acct, path);
    return NextResponse.json({ ok: true, path });
  } catch (error) {
    return fail(error);
  }
}

// PATCH /api/drive  { src, dst, type? }
//   file   (default): src = raw key, dst = display path  -> move/rename file
//   folder (type=folder): src/dst = display paths        -> move/rename folder
export async function PATCH(request: Request) {
  const acct = await account();
  if (!acct) return unauthorized();
  try {
    const { src, dst, type } = (await request.json().catch(() => ({}))) as {
      src?: string;
      dst?: string;
      type?: string;
    };
    if (!src || !dst)
      return NextResponse.json(
        { error: "src and dst required" },
        { status: 400 },
      );
    if (src.includes("..") || dst.includes(".."))
      return NextResponse.json(
        { ok: false, error: "invalid_path", reason: "路徑不合法" },
        { status: 422 },
      );
    const storage = filesStorageFromEnv();
    const d = dst.trim().replace(/^\/+|\/+$/g, "");
    if (type === "folder") {
      const s = src.trim().replace(/^\/+|\/+$/g, "");
      const moved = await storage.moveDir(acct, s, d);
      return NextResponse.json({ ok: true, moved, path: d });
    }
    const s = src.trim().replace(/^\/+/, "");
    const dstKey = encodePath(d);
    if (dstKey !== s) await storage.move(acct, s, dstKey);
    return NextResponse.json({
      ok: true,
      src: s,
      path: dstKey,
      name: displaySeg(d.split("/").pop() ?? ""),
    });
  } catch (error) {
    return fail(error);
  }
}

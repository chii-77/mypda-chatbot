import { NextResponse } from "next/server";
import { getSession } from "auth/server";
import { mcpClientsManager } from "lib/ai/mcp/mcp-manager";
import { selectMcpClientsAction } from "../mcp/actions";

/**
 * File Explorer ("Drive") backend — a thin server-side proxy that routes every
 * file operation through the DataPilot MCP (files-mcp), NOT the direct Supabase
 * connector used by the legacy /api/files. This makes the UI a thin skin over
 * the exact same tools the chat agent calls (single source of truth: the Python
 * MCP owns E64 non-ASCII handling, categories, and upload validation), so a
 * button click and an agent tool-call do identical things.
 *
 * Auth + per-user isolation are enforced by selectMcpClientsAction (only the
 * caller's own MCP servers are reachable). Heavy fan-out / big downloads stay
 * off this path: downloads use signed URLs via /api/files/download.
 */

// Resolve the caller's files-mcp server id. Names are per-user unique
// (`files-mcp-<id>` after the collision-avoidance rename), so match by the
// distinctive `list_files` tool first, then fall back to the name prefix.
async function resolveFilesServerId(): Promise<string> {
  const servers = await selectMcpClientsAction();
  const target = servers.find(
    (s) =>
      (s.toolInfo ?? []).some((t) => t.name === "list_files") ||
      (s.name ?? "").startsWith("files-mcp"),
  );
  if (!target) throw new Error("FilesUnavailable");
  return target.id;
}

// Pull the structured object out of an MCP tool result (structuredContent, an
// object text block, or a JSON string) — mirrors the artifact bridge's json().
function unwrap(result: any): any {
  if (result?.structuredContent != null) return result.structuredContent;
  for (const p of result?.content ?? []) {
    if (p?.type === "text" && p.text != null) {
      if (typeof p.text === "object") return p.text;
      try {
        return JSON.parse(p.text);
      } catch {
        return p.text;
      }
    }
  }
  return null;
}

async function callFiles(
  tool: string,
  args: Record<string, unknown> = {},
  serverId?: string,
) {
  const id = serverId ?? (await resolveFilesServerId());
  return unwrap(await mcpClientsManager.toolCall(id, tool, args));
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  const status = message === "FilesUnavailable" ? 503 : 500;
  return NextResponse.json({ error: message }, { status });
}

// GET /api/drive?path=<display path>  -> list one folder level (lazy)
export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const path = new URL(request.url).searchParams.get("path") ?? "";
  try {
    const data = await callFiles("list_dir", { prefix: path });
    return NextResponse.json(data ?? { path, folders: [], files: [] });
  } catch (error) {
    return fail(error);
  }
}

// POST /api/drive  (multipart: file, category?)  -> upload_document
export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const form = await request.formData();
    // mkdir: create an (empty) folder at a display path.
    const mkdir = ((form.get("mkdir") as string) || "").trim();
    if (mkdir) {
      const res = await callFiles("make_dir", { path: mkdir });
      if (res?.ok === false) return NextResponse.json(res, { status: 422 });
      return NextResponse.json(res, { status: 201 });
    }
    const file = form.get("file");
    const category = ((form.get("category") as string) || "").trim();
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No file (field 'file')" },
        { status: 400 },
      );
    }
    const content_base64 = Buffer.from(await file.arrayBuffer()).toString(
      "base64",
    );
    const res = await callFiles("upload_document", {
      filename: file.name,
      content_base64,
      category,
      content_type: file.type || "",
    });
    // upload_document returns {ok:false, error, reason} on validation failure.
    if (res?.ok === false) return NextResponse.json(res, { status: 422 });
    return NextResponse.json(res, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}

// DELETE /api/drive?path=<key>[&type=folder]
//   file   (default): path = raw storage key from list_dir files[].path
//   folder (type=folder): path = display path from list_dir folders[].path;
//                         deletes every file under it recursively.
export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const path = url.searchParams.get("path");
  if (!path)
    return NextResponse.json({ error: "Missing path" }, { status: 400 });
  try {
    if (url.searchParams.get("type") === "folder") {
      const res = await callFiles("delete_dir", { prefix: path });
      return NextResponse.json(res ?? { ok: true });
    }
    const res = await callFiles("delete_file", { path });
    return NextResponse.json(res ?? { ok: true });
  } catch (error) {
    return fail(error);
  }
}

// PATCH /api/drive  { src: <raw key>, dst: <display path> }  -> move / rename
export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    const res =
      type === "folder"
        ? await callFiles("move_dir", { src, dst })
        : await callFiles("move_file", { src, dst });
    if (res?.ok === false) return NextResponse.json(res, { status: 422 });
    return NextResponse.json(res ?? { ok: true });
  } catch (error) {
    return fail(error);
  }
}

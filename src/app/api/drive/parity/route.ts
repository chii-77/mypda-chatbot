import { NextResponse } from "next/server";
import { getSession } from "auth/server";
import { mcpClientsManager } from "lib/ai/mcp/mcp-manager";
import { filesStorageFromEnv } from "lib/files/storage";
import { selectMcpClientsAction } from "../../mcp/actions";

/**
 * Parity check between the two "doors" onto the same file home:
 *   web door  — /api/drive (direct Supabase, fast, used by the Files UI)
 *   agent door — the DataPilot files-mcp tools (used by chat)
 *
 * Reports (1) the static 1:1 mapping of web operations to MCP tools — which
 * are aligned, which web ops have no MCP tool, which MCP tools have no web
 * counterpart — and (2) a LIVE functional check: list the root folder through
 * both doors and compare contents (proves the E64 key handling byte-matches),
 * with per-door latency so the speed difference is visible.
 */

// Web operation -> the MCP tool it mirrors. Keep in sync with /api/drive.
const MANIFEST: { web: string; label: string; mcp: string }[] = [
  { web: "GET /api/drive", label: "列出資料夾（一層，惰性）", mcp: "list_dir" },
  {
    web: "POST /api/drive (file)",
    label: "上傳文件（格式/大小驗證）",
    mcp: "upload_document",
  },
  { web: "POST /api/drive (mkdir)", label: "新增資料夾", mcp: "make_dir" },
  { web: "DELETE /api/drive", label: "刪除檔案", mcp: "delete_file" },
  {
    web: "DELETE /api/drive?type=folder",
    label: "刪除整個資料夾（遞迴）",
    mcp: "delete_dir",
  },
  { web: "PATCH /api/drive", label: "移動 / 重新命名檔案", mcp: "move_file" },
  {
    web: "PATCH /api/drive (folder)",
    label: "移動 / 重新命名資料夾",
    mcp: "move_dir",
  },
  {
    web: "GET /api/files/download",
    label: "下載（簽名 URL）",
    mcp: "read_file_base64",
  },
];

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

export async function GET() {
  const session = await getSession();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Resolve the caller's files-mcp server.
  const servers = await selectMcpClientsAction();
  const target = servers.find(
    (s) =>
      (s.toolInfo ?? []).some((t) => t.name === "list_dir") ||
      (s.name ?? "").startsWith("files-mcp"),
  );
  if (!target) {
    return NextResponse.json({
      ok: false,
      error: "找不到 files-mcp（該帳號未連接檔案 MCP）",
    });
  }
  const mcpTools = (target.toolInfo ?? []).map((t) => t.name);

  // Static mapping.
  const aligned = MANIFEST.filter((m) => mcpTools.includes(m.mcp));
  const webOnly = MANIFEST.filter((m) => !mcpTools.includes(m.mcp));
  const mcpOnly = mcpTools.filter((t) => !MANIFEST.some((m) => m.mcp === t));

  // Live functional check: root listing through both doors, timed.
  const acct = session.user.id;
  let direct: { folders: string[]; files: string[] } | null = null;
  let viaMcp: { folders: string[]; files: string[] } | null = null;
  let directMs = -1;
  let mcpMs = -1;
  let checkError: string | null = null;
  try {
    let t = Date.now();
    const d = await filesStorageFromEnv().listDir(acct, "");
    directMs = Date.now() - t;
    direct = {
      folders: d.folders.map((f) => f.name).sort(),
      files: d.files.map((f) => f.name).sort(),
    };
    t = Date.now();
    const m = unwrap(
      await mcpClientsManager.toolCall(target.id, "list_dir", { prefix: "" }),
    );
    mcpMs = Date.now() - t;
    viaMcp = {
      folders: (m?.folders ?? []).map((f: any) => f.name).sort(),
      files: (m?.files ?? []).map((f: any) => f.name).sort(),
    };
  } catch (e: any) {
    checkError = e?.message ?? "live check failed";
  }

  const diff = (a: string[] = [], b: string[] = []) =>
    a.filter((x) => !b.includes(x));
  const equal =
    !!direct && !!viaMcp && JSON.stringify(direct) === JSON.stringify(viaMcp);

  return NextResponse.json({
    ok: true,
    server: { id: target.id, name: target.name, toolCount: mcpTools.length },
    mapping: { aligned, webOnly, mcpOnly },
    live: {
      error: checkError,
      equal,
      directMs,
      mcpMs,
      onlyDirect:
        direct && viaMcp
          ? {
              folders: diff(direct.folders, viaMcp.folders),
              files: diff(direct.files, viaMcp.files),
            }
          : null,
      onlyMcp:
        direct && viaMcp
          ? {
              folders: diff(viaMcp.folders, direct.folders),
              files: diff(viaMcp.files, direct.files),
            }
          : null,
    },
  });
}

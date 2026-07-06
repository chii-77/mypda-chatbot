// Per-account file storage over Supabase Storage (the single "file home").
// Files live under `<userId>/...`; the account prefix is hidden from callers,
// matching the Python MCP server (datapilot-pdf) so a file uploaded in the UI
// is visible to the agent's list_files for the same user.
//
// Server-side only: uses the Supabase service_role key over the Storage REST
// API (no @supabase/supabase-js dependency).

export function scope(account: string, path = ""): string {
  const p = (path || "").replace(/^\/+|\/+$/g, "");
  return p ? `${account}/${p}` : account;
}

export function unscope(account: string, full: string): string {
  const pre = `${account}/`;
  return full.startsWith(pre) ? full.slice(pre.length) : full;
}

export interface FileEntry {
  path: string; // user-relative
  size: number | null;
  updatedAt?: string | null;
}

// ── E64 non-ASCII key segments ──────────────────────────────────────────────
// Supabase Storage only accepts ASCII keys, so non-ASCII path segments are
// stored base64url-encoded with an "E64-" marker. This MUST byte-match the
// Python MCP server's _key_seg/_display_seg (datapilot/server/app.py) so both
// doors (this direct connector and the files-mcp tools) see identical keys.
const E64_MARK = "E64-";

export function keySeg(seg: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(seg)) return seg; // ASCII passes through
  return E64_MARK + Buffer.from(seg, "utf8").toString("base64url");
}

export function displaySeg(seg: string): string {
  if (!seg.startsWith(E64_MARK)) return seg;
  try {
    const raw = Buffer.from(seg.slice(E64_MARK.length), "base64url").toString(
      "utf8",
    );
    return raw || seg;
  } catch {
    return seg;
  }
}

/** Display path ("報表/2026.pdf") -> raw storage key path (E64-encoded segs). */
export function encodePath(displayPath: string): string {
  return (displayPath || "").split("/").filter(Boolean).map(keySeg).join("/");
}

/** Raw storage key path -> display path (decode E64 segs). */
export function decodePath(rawKey: string): string {
  return (rawKey || "").split("/").map(displaySeg).join("/");
}

// list_dir result shapes — match the MCP list_dir tool exactly so the /api/drive
// contract is identical whichever backend serves it.
export interface DriveFolder {
  name: string;
  path: string; // display path (feed back into listDir to descend)
}
export interface DriveFileEntry {
  path: string; // raw storage key (account-relative) — use for delete/move/sign
  name: string;
  display_path: string;
  size: number | null;
  content_type: string | null;
  uploaded_at: string | null;
}
export interface DriveListing {
  path: string;
  folders: DriveFolder[];
  files: DriveFileEntry[];
}

const MAX_DEPTH = 6;

export class FilesStorage {
  private base: string;
  private bucket: string;
  private headers: Record<string, string>;
  private fetchImpl: typeof fetch;

  constructor(opts: {
    url: string;
    serviceKey: string;
    bucket: string;
    fetchImpl?: typeof fetch;
  }) {
    this.base = opts.url.replace(/\/$/, "");
    this.bucket = opts.bucket;
    this.headers = {
      apikey: opts.serviceKey,
      Authorization: `Bearer ${opts.serviceKey}`,
    };
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async listOne(prefix: string): Promise<any[]> {
    const res = await this.fetchImpl(
      `${this.base}/storage/v1/object/list/${this.bucket}`,
      {
        method: "POST",
        headers: { ...this.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
      },
    );
    if (!res.ok) throw new Error(`list failed: ${res.status}`);
    return (await res.json()) || [];
  }

  async list(account: string, prefix = "", _depth = 0): Promise<FileEntry[]> {
    const out: FileEntry[] = [];
    for (const entry of await this.listOne(scope(account, prefix))) {
      const name = entry?.name;
      if (!name) continue;
      const rel = prefix ? `${prefix}/${name}` : name;
      const isFolder = entry.id == null;
      if (isFolder) {
        if (_depth < MAX_DEPTH)
          out.push(...(await this.list(account, rel, _depth + 1)));
      } else {
        out.push({
          path: rel,
          size: entry.metadata?.size ?? null,
          updatedAt: entry.updated_at ?? null,
        });
      }
    }
    return out;
  }

  async upload(
    account: string,
    path: string,
    bytes: Uint8Array | ArrayBuffer,
    contentType = "application/octet-stream",
  ): Promise<void> {
    const res = await this.fetchImpl(
      `${this.base}/storage/v1/object/${this.bucket}/${scope(account, path)}`,
      {
        method: "POST",
        headers: {
          ...this.headers,
          "Content-Type": contentType,
          "x-upsert": "true",
        },
        body: bytes as any,
      },
    );
    if (!res.ok)
      throw new Error(`upload failed: ${res.status} ${await res.text()}`);
  }

  async remove(account: string, path: string): Promise<void> {
    const res = await this.fetchImpl(
      `${this.base}/storage/v1/object/${this.bucket}/${scope(account, path)}`,
      { method: "DELETE", headers: this.headers },
    );
    if (!res.ok) throw new Error(`delete failed: ${res.status}`);
  }

  /** One level, non-recursive listing (folders + files) for the file explorer.
   * `displayPrefix` is a display path ("" = root); E64 encode on the way in,
   * decode on the way out. Hidden (dot) items and Supabase's own placeholder
   * objects are skipped — mirrors the MCP list_dir tool. */
  async listDir(account: string, displayPrefix = ""): Promise<DriveListing> {
    const keyPrefix = encodePath(displayPrefix);
    const folders: DriveFolder[] = [];
    const files: DriveFileEntry[] = [];
    for (const entry of await this.listOne(scope(account, keyPrefix))) {
      const name = entry?.name;
      if (!name || name === ".emptyFolderPlaceholder") continue;
      const rawRel = keyPrefix ? `${keyPrefix}/${name}` : name;
      const disp = decodePath(rawRel);
      const leaf = disp.split("/").pop() ?? "";
      if (leaf.startsWith(".")) continue;
      if (entry.id == null) {
        folders.push({ name: leaf, path: disp });
      } else {
        files.push({
          path: rawRel,
          name: leaf,
          display_path: disp,
          size: entry.metadata?.size ?? null,
          content_type: entry.metadata?.mimetype ?? null,
          uploaded_at: entry.updated_at ?? entry.created_at ?? null,
        });
      }
    }
    return { path: displayPrefix, folders, files };
  }

  /** Move/rename one object (raw account-relative keys). */
  async move(account: string, srcKey: string, dstKey: string): Promise<void> {
    const res = await this.fetchImpl(`${this.base}/storage/v1/object/move`, {
      method: "POST",
      headers: { ...this.headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        bucketId: this.bucket,
        sourceKey: scope(account, srcKey),
        destinationKey: scope(account, dstKey),
      }),
    });
    if (!res.ok)
      throw new Error(`move failed: ${res.status} ${await res.text()}`);
  }

  /** Create an (empty) folder by writing a hidden .keep placeholder. */
  async makeDir(account: string, displayPath: string): Promise<void> {
    const key = encodePath(displayPath);
    await this.upload(
      account,
      `${key}/.keep`,
      new TextEncoder().encode(" "),
      "text/plain",
    );
  }

  /** Recursively delete everything under a display-path folder (including
   * hidden placeholders). Returns the number of deleted objects. */
  async deleteDir(account: string, displayPrefix: string): Promise<number> {
    const keyPrefix = encodePath(displayPrefix);
    const all = await this.list(account, keyPrefix); // recursive, raw rel keys
    for (const f of all) await this.remove(account, f.path);
    return all.length;
  }

  /** Recursively move/rename a whole display-path folder. Returns count. */
  async moveDir(
    account: string,
    srcDisplay: string,
    dstDisplay: string,
  ): Promise<number> {
    const srcKey = encodePath(srcDisplay);
    const dstKey = encodePath(dstDisplay);
    if (srcKey === dstKey) return 0;
    const all = await this.list(account, srcKey);
    let moved = 0;
    for (const f of all) {
      const rel = f.path;
      const newRel =
        rel === srcKey ? dstKey : dstKey + rel.slice(srcKey.length);
      await this.move(account, rel, newRel);
      moved++;
    }
    return moved;
  }

  async signedDownloadUrl(
    account: string,
    path: string,
    expiresIn = 3600,
  ): Promise<string> {
    const res = await this.fetchImpl(
      `${this.base}/storage/v1/object/sign/${this.bucket}/${scope(account, path)}`,
      {
        method: "POST",
        headers: { ...this.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn }),
      },
    );
    if (!res.ok) throw new Error(`sign failed: ${res.status}`);
    const { signedURL } = await res.json();
    return `${this.base}/storage/v1${signedURL}`;
  }
}

export function filesStorageFromEnv(): FilesStorage {
  return new FilesStorage({
    url: process.env.SUPABASE_URL!,
    serviceKey: process.env.SUPABASE_SERVICE_KEY!,
    bucket: process.env.STORAGE_BUCKET || "datapilot",
  });
}

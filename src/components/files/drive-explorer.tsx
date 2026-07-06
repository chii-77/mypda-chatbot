"use client";
import { fetcher, cn } from "lib/utils";
import { relativeTime } from "lib/memory/format";
import { Button } from "ui/button";
import { toast } from "sonner";
import { useCallback, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import {
  ChevronRight,
  ChevronUp,
  FileIcon,
  FileText,
  FileSpreadsheet,
  Folder,
  HardDrive,
  LayoutGrid,
  List as ListIcon,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";

// ── types matching DataPilot list_dir (via /api/drive) ─────────────────────
type DriveFolder = { name: string; path: string }; // path = display path
type DriveFile = {
  path: string; // raw storage key (delete / download)
  name: string;
  display_path: string;
  size: number | null;
  content_type: string | null;
  uploaded_at: string | null;
};
type DriveListing = {
  path: string;
  folders: DriveFolder[];
  files: DriveFile[];
};

function humanSize(n: number | null): string {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function FileGlyph({ file, big }: { file: DriveFile; big?: boolean }) {
  const size = big ? "size-9" : "size-4";
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const ct = file.content_type ?? "";
  let Icon = FileIcon;
  if (ext === "pdf" || ct.includes("pdf")) Icon = FileText;
  else if (["csv", "xlsx", "xls"].includes(ext) || ct.includes("sheet"))
    Icon = FileSpreadsheet;
  else if (["md", "txt", "markdown"].includes(ext) || ct.startsWith("text/"))
    Icon = FileText;
  return <Icon className={cn(size, "shrink-0 text-muted-foreground")} />;
}

export function DriveExplorer() {
  const [path, setPath] = useState(""); // current folder (display path, "" = root)
  const [view, setView] = useState<"grid" | "list">("grid");
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const key = `/api/drive?path=${encodeURIComponent(path)}`;
  const { data, error, isLoading, isValidating, mutate } = useSWR<DriveListing>(
    key,
    fetcher,
    { revalidateOnFocus: false, keepPreviousData: true },
  );

  const folders = data?.folders ?? [];
  const files = data?.files ?? [];
  const failed = !!error && !data;
  const empty =
    !isLoading && !failed && folders.length === 0 && files.length === 0;

  const crumbs = useMemo(() => {
    const segs = path ? path.split("/") : [];
    return segs.map((seg, i) => ({
      seg,
      path: segs.slice(0, i + 1).join("/"),
    }));
  }, [path]);

  const goUp = useCallback(() => {
    setPath((p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ""));
  }, []);

  async function uploadFiles(list: FileList | File[]) {
    const arr = Array.from(list);
    if (!arr.length) return;
    setBusy(true);
    let ok = 0;
    for (const file of arr) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        if (path) fd.append("category", path); // upload into current folder
        const res = await fetch("/api/drive", { method: "POST", body: fd });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json?.ok === false) {
          throw new Error(json?.reason || json?.error || "上傳失敗");
        }
        ok++;
      } catch (err: any) {
        toast.error(`${file.name}：${err.message}`);
      }
    }
    if (ok) toast.success(`已上傳 ${ok} 個檔案`);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    mutate();
  }

  async function remove(f: DriveFile) {
    if (!confirm(`確定刪除「${f.name}」？`)) return;
    // optimistic: drop it from the current listing immediately
    mutate(
      (cur) =>
        cur
          ? { ...cur, files: cur.files.filter((x) => x.path !== f.path) }
          : cur,
      { revalidate: false },
    );
    try {
      const res = await fetch(`/api/drive?path=${encodeURIComponent(f.path)}`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) throw new Error("刪除失敗");
      toast.success("已刪除");
    } catch {
      toast.error("刪除失敗");
      mutate(); // reconcile on failure
    }
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col p-4 sm:p-6">
      {/* toolbar */}
      <div className="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          disabled={!path}
          onClick={goUp}
          title="上一層"
        >
          <ChevronUp className="size-4" />
        </Button>

        {/* breadcrumb */}
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-sm">
          <button
            type="button"
            onClick={() => setPath("")}
            className={cn(
              "flex items-center gap-1 rounded px-1.5 py-1 hover:bg-muted",
              !path && "font-semibold",
            )}
          >
            <HardDrive className="size-4" />
            檔案總管
          </button>
          {crumbs.map((c) => (
            <div key={c.path} className="flex items-center gap-0.5">
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />
              <button
                type="button"
                onClick={() => setPath(c.path)}
                className={cn(
                  "truncate rounded px-1.5 py-1 hover:bg-muted",
                  c.path === path && "font-semibold",
                )}
              >
                {c.seg}
              </button>
            </div>
          ))}
          {isValidating && (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground/60" />
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <div className="flex rounded-md border">
            <Button
              variant={view === "grid" ? "secondary" : "ghost"}
              size="icon"
              className="size-8 rounded-r-none"
              onClick={() => setView("grid")}
              title="格線"
            >
              <LayoutGrid className="size-4" />
            </Button>
            <Button
              variant={view === "list" ? "secondary" : "ghost"}
              size="icon"
              className="size-8 rounded-l-none"
              onClick={() => setView("list")}
              title="清單"
            >
              <ListIcon className="size-4" />
            </Button>
          </div>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => mutate()}
            title="重新整理"
          >
            <RefreshCw
              className={cn("size-4", isValidating && "animate-spin")}
            />
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            上傳
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && uploadFiles(e.target.files)}
          />
        </div>
      </div>

      {/* body (drop zone) */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
        }}
        className={cn(
          "mt-3 min-h-0 flex-1 overflow-y-auto rounded-lg border transition-colors",
          dragOver && "border-primary bg-primary/5",
        )}
      >
        {isLoading ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> 載入中…
          </div>
        ) : failed ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <span>載入失敗:可能是 DataPilot 檔案服務未連線。</span>
            <Button variant="outline" size="sm" onClick={() => mutate()}>
              <RefreshCw className="size-4" /> 重試
            </Button>
          </div>
        ) : empty ? (
          <div className="flex h-40 flex-col items-center justify-center gap-1 text-sm text-muted-foreground">
            <Folder className="size-8 opacity-40" />
            這個資料夾是空的。把檔案拖進來,或用右上角「上傳」。
          </div>
        ) : view === "grid" ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-1 p-3">
            {folders.map((f) => (
              <button
                key={f.path}
                type="button"
                onDoubleClick={() => setPath(f.path)}
                onClick={() => setPath(f.path)}
                className="group flex flex-col items-center gap-1.5 rounded-lg p-3 text-center hover:bg-muted"
              >
                <Folder className="size-9 shrink-0 fill-muted-foreground/20 text-muted-foreground" />
                <span className="line-clamp-2 w-full break-words text-xs">
                  {f.name}
                </span>
              </button>
            ))}
            {files.map((f) => (
              <div
                key={f.path}
                className="group relative flex flex-col items-center gap-1.5 rounded-lg p-3 text-center hover:bg-muted"
              >
                <a
                  href={`/api/files/download?path=${encodeURIComponent(f.path)}`}
                  className="flex flex-col items-center gap-1.5"
                  title="點擊下載"
                >
                  <FileGlyph file={f} big />
                  <span className="line-clamp-2 w-full break-words text-xs">
                    {f.name}
                  </span>
                </a>
                <button
                  type="button"
                  onClick={() => remove(f)}
                  className="absolute right-1 top-1 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                  title="刪除"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col divide-y">
            {folders.map((f) => (
              <button
                key={f.path}
                type="button"
                onClick={() => setPath(f.path)}
                className="flex items-center gap-3 px-3 py-2 text-left hover:bg-muted"
              >
                <Folder className="size-4 shrink-0 fill-muted-foreground/20 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {f.name}
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />
              </button>
            ))}
            {files.map((f) => (
              <div
                key={f.path}
                className="group flex items-center gap-3 px-3 py-2 hover:bg-muted"
              >
                <FileGlyph file={f} />
                <a
                  href={`/api/files/download?path=${encodeURIComponent(f.path)}`}
                  className="min-w-0 flex-1 truncate text-sm hover:underline"
                  title="點擊下載"
                >
                  {f.name}
                </a>
                <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
                  {humanSize(f.size)}
                </span>
                <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground sm:block">
                  {f.uploaded_at ? relativeTime(f.uploaded_at) : ""}
                </span>
                <button
                  type="button"
                  onClick={() => remove(f)}
                  className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  title="刪除"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="mt-2 shrink-0 text-xs text-muted-foreground">
        {folders.length > 0 && `${folders.length} 個資料夾 · `}
        {files.length} 個檔案 · 檔案由 DataPilot 管理,與 AI 助理看到的一致
      </p>
    </div>
  );
}

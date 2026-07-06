"use client";
import { fetcher, cn } from "lib/utils";
import { relativeTime } from "lib/memory/format";
import { Button } from "ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "ui/dropdown-menu";
import { toast } from "sonner";
import { useCallback, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  ChevronRight,
  ChevronUp,
  Download,
  FileIcon,
  FileText,
  FileSpreadsheet,
  Folder,
  FolderOpen,
  HardDrive,
  LayoutGrid,
  List as ListIcon,
  ListChecks,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Square,
  SquareCheckBig,
  Trash2,
  Upload,
  X,
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

type SortKey = "name" | "modified" | "size" | "type";
const SORT_LABELS: [SortKey, string][] = [
  ["name", "名稱"],
  ["modified", "時間"],
  ["size", "大小"],
  ["type", "類型"],
];

const extOf = (n: string) => n.split(".").pop()?.toLowerCase() ?? "";

function humanSize(n: number | null): string {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function FileGlyph({ file, big }: { file: DriveFile; big?: boolean }) {
  const size = big ? "size-9" : "size-4";
  const ext = extOf(file.name);
  const ct = file.content_type ?? "";
  let Icon = FileIcon;
  if (ext === "pdf" || ct.includes("pdf")) Icon = FileText;
  else if (["csv", "xlsx", "xls"].includes(ext) || ct.includes("sheet"))
    Icon = FileSpreadsheet;
  else if (["md", "txt", "markdown"].includes(ext) || ct.startsWith("text/"))
    Icon = FileText;
  return <Icon className={cn(size, "shrink-0 text-muted-foreground")} />;
}

function downloadUrl(file: DriveFile) {
  return `/api/files/download?path=${encodeURIComponent(file.path)}`;
}

// Per-file "⋯" menu — replaces desktop right-click with an on-screen control.
function FileMenu({
  file,
  onDelete,
  className,
}: {
  file: DriveFile;
  onDelete: () => void;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="更多"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "rounded p-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
            className,
          )}
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem asChild>
          <a href={downloadUrl(file)}>
            <Download className="mr-2 size-4" />
            下載
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={onDelete}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 size-4" />
          刪除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Per-folder "⋯" menu: open / delete the whole folder.
function FolderMenu({
  onOpen,
  onDelete,
  className,
}: {
  onOpen: () => void;
  onDelete: () => void;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="更多"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "rounded p-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
            className,
          )}
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={onOpen}>
          <FolderOpen className="mr-2 size-4" />
          開啟
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={onDelete}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 size-4" />
          刪除整個資料夾
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DriveExplorer() {
  const [path, setPath] = useState(""); // current folder (display path, "" = root)
  const [view, setView] = useState<"grid" | "list">("grid");
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const key = `/api/drive?path=${encodeURIComponent(path)}`;
  const { data, error, isLoading, isValidating, mutate } = useSWR<DriveListing>(
    key,
    fetcher,
    { revalidateOnFocus: false, keepPreviousData: true },
  );

  const failed = !!error && !data;

  const folders = useMemo(() => {
    const arr = [...(data?.folders ?? [])];
    arr.sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
    return sortDir === "desc" ? arr.reverse() : arr;
  }, [data?.folders, sortDir]);

  const files = useMemo(() => {
    const arr = [...(data?.files ?? [])];
    const cmp: Record<SortKey, (a: DriveFile, b: DriveFile) => number> = {
      name: (a, b) => a.name.localeCompare(b.name, "zh-Hant"),
      modified: (a, b) =>
        (a.uploaded_at ?? "").localeCompare(b.uploaded_at ?? ""),
      size: (a, b) => (a.size ?? 0) - (b.size ?? 0),
      type: (a, b) =>
        extOf(a.name).localeCompare(extOf(b.name)) ||
        a.name.localeCompare(b.name, "zh-Hant"),
    };
    arr.sort(cmp[sortBy]);
    return sortDir === "desc" ? arr.reverse() : arr;
  }, [data?.files, sortBy, sortDir]);

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

  const navigate = useCallback((to: string) => {
    setPath(to);
    setSelected(new Set());
  }, []);

  function toggleSelect(p: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(p) ? next.delete(p) : next.add(p);
      return next;
    });
  }

  function exitSelect() {
    setSelectMode(false);
    setSelected(new Set());
  }

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
        if (!res.ok || json?.ok === false)
          throw new Error(json?.reason || json?.error || "上傳失敗");
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

  async function removeFile(f: DriveFile) {
    if (!confirm(`確定刪除「${f.name}」？`)) return;
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
      mutate();
    }
  }

  async function removeFolder(f: DriveFolder) {
    if (!confirm(`確定刪除整個資料夾「${f.name}」及其所有檔案？`)) return;
    mutate(
      (cur) =>
        cur
          ? { ...cur, folders: cur.folders.filter((x) => x.path !== f.path) }
          : cur,
      { revalidate: false },
    );
    try {
      const res = await fetch(
        `/api/drive?path=${encodeURIComponent(f.path)}&type=folder`,
        { method: "DELETE" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) throw new Error("刪除失敗");
      toast.success(`已刪除資料夾（${json.deleted ?? 0} 個檔案）`);
    } catch {
      toast.error("刪除資料夾失敗");
      mutate();
    }
  }

  function batchDownload() {
    files
      .filter((f) => selected.has(f.path))
      .forEach((f) => {
        const a = document.createElement("a");
        a.href = downloadUrl(f);
        document.body.appendChild(a);
        a.click();
        a.remove();
      });
  }

  async function batchDelete() {
    const picked = [...selected];
    if (!picked.length) return;
    if (!confirm(`確定刪除選取的 ${picked.length} 個檔案？`)) return;
    mutate(
      (cur) =>
        cur
          ? { ...cur, files: cur.files.filter((x) => !selected.has(x.path)) }
          : cur,
      { revalidate: false },
    );
    setSelected(new Set());
    try {
      await Promise.all(
        picked.map((p) =>
          fetch(`/api/drive?path=${encodeURIComponent(p)}`, {
            method: "DELETE",
          }),
        ),
      );
      toast.success(`已刪除 ${picked.length} 個檔案`);
    } catch {
      toast.error("部分刪除失敗");
    }
    mutate();
  }

  function setSort(k: SortKey) {
    if (k === sortBy) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(k);
      setSortDir("asc");
    }
  }

  const allSelected = files.length > 0 && selected.size === files.length;

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
            onClick={() => navigate("")}
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
                onClick={() => navigate(c.path)}
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
          {/* sort */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                title="排序"
              >
                <ArrowDownUp className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {SORT_LABELS.map(([k, label]) => (
                <DropdownMenuItem
                  key={k}
                  onSelect={(e) => {
                    e.preventDefault();
                    setSort(k);
                  }}
                >
                  <span className="flex-1">{label}</span>
                  {sortBy === k &&
                    (sortDir === "asc" ? (
                      <ArrowUp className="size-4" />
                    ) : (
                      <ArrowDown className="size-4" />
                    ))}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* select mode */}
          <Button
            variant={selectMode ? "secondary" : "outline"}
            size="icon"
            className="size-8"
            title="選取"
            onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
          >
            <ListChecks className="size-4" />
          </Button>

          {/* view toggle */}
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

      {/* selection action bar */}
      {selectMode && (
        <div className="mt-2 flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-sm">
          <button
            type="button"
            className="rounded px-1.5 py-0.5 hover:bg-muted"
            onClick={() =>
              setSelected(
                allSelected ? new Set() : new Set(files.map((f) => f.path)),
              )
            }
          >
            {allSelected ? "取消全選" : "全選"}
          </button>
          <span className="text-muted-foreground">已選 {selected.size} 項</span>
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            disabled={!selected.size}
            onClick={batchDownload}
          >
            <Download className="size-4" /> 下載
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive"
            disabled={!selected.size}
            onClick={batchDelete}
          >
            <Trash2 className="size-4" /> 刪除
          </Button>
          <Button variant="ghost" size="sm" onClick={exitSelect}>
            <X className="size-4" /> 取消
          </Button>
        </div>
      )}

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
          <div className="grid grid-cols-[repeat(auto-fill,minmax(116px,1fr))] gap-1 p-3">
            {folders.map((f) => (
              <div
                key={f.path}
                className="group relative flex w-full min-w-0 flex-col items-center gap-1.5 rounded-lg p-2 text-center hover:bg-muted"
              >
                <button
                  type="button"
                  onClick={() => navigate(f.path)}
                  className="flex w-full min-w-0 flex-col items-center gap-1.5"
                >
                  <Folder className="size-9 shrink-0 fill-muted-foreground/20 text-muted-foreground" />
                  <span className="line-clamp-2 w-full break-all text-xs leading-tight">
                    {f.name}
                  </span>
                </button>
                {!selectMode && (
                  <FolderMenu
                    onOpen={() => navigate(f.path)}
                    onDelete={() => removeFolder(f)}
                    className="absolute right-0.5 top-0.5 bg-background/80 opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
                  />
                )}
              </div>
            ))}
            {files.map((f) => {
              const sel = selected.has(f.path);
              return (
                <div
                  key={f.path}
                  className={cn(
                    "group relative flex w-full min-w-0 flex-col items-center gap-1.5 rounded-lg p-2 text-center hover:bg-muted",
                    sel && "bg-primary/10 ring-1 ring-primary",
                  )}
                >
                  {selectMode ? (
                    <button
                      type="button"
                      onClick={() => toggleSelect(f.path)}
                      className="flex w-full min-w-0 flex-col items-center gap-1.5"
                    >
                      <FileGlyph file={f} big />
                      <span className="line-clamp-2 w-full break-all text-xs leading-tight">
                        {f.name}
                      </span>
                    </button>
                  ) : (
                    <a
                      href={downloadUrl(f)}
                      className="flex w-full min-w-0 flex-col items-center gap-1.5"
                      title="點擊下載"
                    >
                      <FileGlyph file={f} big />
                      <span className="line-clamp-2 w-full break-all text-xs leading-tight">
                        {f.name}
                      </span>
                    </a>
                  )}
                  {selectMode ? (
                    <span className="absolute left-1 top-1">
                      {sel ? (
                        <SquareCheckBig className="size-4 text-primary" />
                      ) : (
                        <Square className="size-4 text-muted-foreground" />
                      )}
                    </span>
                  ) : (
                    <FileMenu
                      file={f}
                      onDelete={() => removeFile(f)}
                      className="absolute right-0.5 top-0.5 bg-background/80 opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
                    />
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col divide-y">
            {folders.map((f) => (
              <div
                key={f.path}
                className="group flex items-center gap-3 px-3 py-2 hover:bg-muted"
              >
                <button
                  type="button"
                  onClick={() => navigate(f.path)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <Folder className="size-4 shrink-0 fill-muted-foreground/20 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {f.name}
                  </span>
                </button>
                {!selectMode && (
                  <FolderMenu
                    onOpen={() => navigate(f.path)}
                    onDelete={() => removeFolder(f)}
                    className="opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
                  />
                )}
              </div>
            ))}
            {files.map((f) => {
              const sel = selected.has(f.path);
              return (
                <div
                  key={f.path}
                  className={cn(
                    "group flex items-center gap-3 px-3 py-2 hover:bg-muted",
                    sel && "bg-primary/10",
                  )}
                >
                  {selectMode && (
                    <button
                      type="button"
                      onClick={() => toggleSelect(f.path)}
                      className="shrink-0"
                    >
                      {sel ? (
                        <SquareCheckBig className="size-4 text-primary" />
                      ) : (
                        <Square className="size-4 text-muted-foreground" />
                      )}
                    </button>
                  )}
                  <FileGlyph file={f} />
                  {selectMode ? (
                    <button
                      type="button"
                      onClick={() => toggleSelect(f.path)}
                      className="min-w-0 flex-1 truncate text-left text-sm"
                    >
                      {f.name}
                    </button>
                  ) : (
                    <a
                      href={downloadUrl(f)}
                      className="min-w-0 flex-1 truncate text-sm hover:underline"
                      title="點擊下載"
                    >
                      {f.name}
                    </a>
                  )}
                  <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
                    {humanSize(f.size)}
                  </span>
                  <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground sm:block">
                    {f.uploaded_at ? relativeTime(f.uploaded_at) : ""}
                  </span>
                  {!selectMode && (
                    <FileMenu
                      file={f}
                      onDelete={() => removeFile(f)}
                      className="opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
                    />
                  )}
                </div>
              );
            })}
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

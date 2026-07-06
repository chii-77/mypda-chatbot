"use client";
import { fetcher, cn } from "lib/utils";
import { relativeTime } from "lib/memory/format";
import { Button } from "ui/button";
import { Input } from "ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  FileSpreadsheet,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  HardDrive,
  LayoutGrid,
  List as ListIcon,
  ListChecks,
  Loader2,
  Pencil,
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
  path: string; // raw storage key (delete / download / move src)
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

// Colourful, Puter-style file glyphs (theme-independent accent colours).
function FileGlyph({ file, big }: { file: DriveFile; big?: boolean }) {
  const size = big ? "size-10" : "size-4";
  const ext = extOf(file.name);
  const ct = file.content_type ?? "";
  let Icon = FileIcon;
  let color = "text-muted-foreground";
  if (ext === "pdf" || ct.includes("pdf")) {
    Icon = FileText;
    color = "text-rose-500";
  } else if (["csv", "xlsx", "xls"].includes(ext) || ct.includes("sheet")) {
    Icon = FileSpreadsheet;
    color = "text-emerald-600";
  } else if (
    ["md", "txt", "markdown"].includes(ext) ||
    ct.startsWith("text/")
  ) {
    Icon = FileText;
    color = "text-sky-600";
  }
  return <Icon className={cn(size, "shrink-0", color)} />;
}

// Puter's signature yellow folder.
function FolderGlyph({ big }: { big?: boolean }) {
  return (
    <Folder
      className={cn(
        big ? "size-10" : "size-4",
        "shrink-0 fill-amber-400 text-amber-500",
      )}
    />
  );
}

function downloadUrl(file: DriveFile) {
  return `/api/files/download?path=${encodeURIComponent(file.path)}`;
}

export function DriveExplorer() {
  const [path, setPath] = useState(""); // current folder (display path)
  const [view, setView] = useState<"grid" | "list">("grid");
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null); // item path
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const key = `/api/drive?path=${encodeURIComponent(path)}`;
  const { data, error, isLoading, isValidating, mutate } = useSWR<DriveListing>(
    key,
    fetcher,
    { revalidateOnFocus: false, keepPreviousData: true },
  );
  // Root folders for the left "Favorites" rail (dedup'd with the main fetch
  // when we're already at root).
  const { data: rootData, mutate: mutateRoot } = useSWR<DriveListing>(
    "/api/drive?path=",
    fetcher,
    { revalidateOnFocus: false },
  );
  const rootFolders = rootData?.folders ?? [];

  const refresh = useCallback(() => {
    mutate();
    mutateRoot();
  }, [mutate, mutateRoot]);

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

  // Move targets: root + top-level folders (minus the item's own subtree).
  const moveTargets = useCallback(
    (selfFolderPath?: string) => {
      const out: { label: string; path: string }[] = [];
      if (path !== "") out.push({ label: "根目錄", path: "" });
      for (const rf of rootFolders) {
        if (selfFolderPath && rf.path === selfFolderPath) continue;
        if (rf.path === path) continue; // already here
        out.push({ label: rf.name, path: rf.path });
      }
      return out;
    },
    [rootFolders, path],
  );

  const navigate = useCallback((to: string) => {
    setPath(to);
    setSelected(new Set());
    setRenaming(null);
  }, []);

  const goUp = useCallback(() => {
    navigate(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
  }, [path, navigate]);

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

  // ── mutations ────────────────────────────────────────────────────────────
  async function uploadFiles(list: FileList | File[]) {
    const arr = Array.from(list);
    if (!arr.length) return;
    setBusy(true);
    let ok = 0;
    for (const file of arr) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        if (path) fd.append("category", path);
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
    refresh();
  }

  async function newFolder() {
    const existing = new Set(folders.map((f) => f.name));
    let name = "新資料夾";
    let i = 2;
    while (existing.has(name)) name = `新資料夾 ${i++}`;
    const full = path ? `${path}/${name}` : name;
    const fd = new FormData();
    fd.append("mkdir", full);
    const res = await fetch("/api/drive", { method: "POST", body: fd });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.ok === false) {
      toast.error(json?.reason || "建立資料夾失敗");
      return;
    }
    await Promise.all([mutate(), mutateRoot()]);
    setRenaming(full); // let the user name it immediately
    setRenameValue(name);
  }

  async function removeFile(f: DriveFile) {
    if (!confirm(`確定刪除「${f.name}」？`)) return;
    mutate(
      (c) =>
        c ? { ...c, files: c.files.filter((x) => x.path !== f.path) } : c,
      { revalidate: false },
    );
    try {
      const res = await fetch(`/api/drive?path=${encodeURIComponent(f.path)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      toast.success("已刪除");
    } catch {
      toast.error("刪除失敗");
      mutate();
    }
  }

  async function removeFolder(f: DriveFolder) {
    if (!confirm(`確定刪除整個資料夾「${f.name}」及其所有檔案？`)) return;
    mutate(
      (c) =>
        c ? { ...c, folders: c.folders.filter((x) => x.path !== f.path) } : c,
      { revalidate: false },
    );
    try {
      const res = await fetch(
        `/api/drive?path=${encodeURIComponent(f.path)}&type=folder`,
        { method: "DELETE" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) throw new Error();
      toast.success(`已刪除資料夾（${json.deleted ?? 0} 個檔案）`);
    } catch {
      toast.error("刪除資料夾失敗");
    }
    refresh();
  }

  function startRename(itemPath: string, currentName: string) {
    setSelectMode(false);
    setRenaming(itemPath);
    setRenameValue(currentName);
  }

  async function commitRename(item: {
    path: string; // file raw key OR folder display path
    name: string;
    isFolder: boolean;
  }) {
    const newName = renameValue.trim();
    setRenaming(null);
    if (!newName || newName === item.name) return;
    const dst = path ? `${path}/${newName}` : newName;
    try {
      const res = await fetch("/api/drive", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          src: item.path,
          dst,
          type: item.isFolder ? "folder" : "file",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false)
        throw new Error(json?.reason || "重新命名失敗");
      toast.success("已重新命名");
    } catch (e: any) {
      toast.error(e.message);
    }
    refresh();
  }

  async function moveItem(
    item: { path: string; name: string; isFolder: boolean },
    targetFolder: string,
  ) {
    const dst = targetFolder ? `${targetFolder}/${item.name}` : item.name;
    try {
      const res = await fetch("/api/drive", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          src: item.path,
          dst,
          type: item.isFolder ? "folder" : "file",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false)
        throw new Error(json?.reason || "移動失敗");
      toast.success(`已移動到「${targetFolder || "根目錄"}」`);
    } catch (e: any) {
      toast.error(e.message);
    }
    refresh();
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
      (c) =>
        c ? { ...c, files: c.files.filter((x) => !selected.has(x.path)) } : c,
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

  // ── shared context-menu contents ─────────────────────────────────────────
  const fileMenu = (f: DriveFile) => (
    <>
      <ContextMenuItem asChild>
        <a href={downloadUrl(f)}>
          <Download className="mr-2 size-4" /> 下載
        </a>
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => startRename(f.path, f.name)}>
        <Pencil className="mr-2 size-4" /> 重新命名
      </ContextMenuItem>
      {moveTargets().length > 0 && (
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <FolderInput className="mr-2 size-4" /> 移動到
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {moveTargets().map((t) => (
              <ContextMenuItem
                key={t.path}
                onSelect={() =>
                  moveItem(
                    { path: f.path, name: f.name, isFolder: false },
                    t.path,
                  )
                }
              >
                {t.label}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem
        onSelect={() => removeFile(f)}
        className="text-destructive focus:text-destructive"
      >
        <Trash2 className="mr-2 size-4" /> 刪除
      </ContextMenuItem>
    </>
  );

  const folderMenu = (f: DriveFolder) => (
    <>
      <ContextMenuItem onSelect={() => navigate(f.path)}>
        <FolderOpen className="mr-2 size-4" /> 開啟
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => startRename(f.path, f.name)}>
        <Pencil className="mr-2 size-4" /> 重新命名
      </ContextMenuItem>
      {moveTargets(f.path).length > 0 && (
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <FolderInput className="mr-2 size-4" /> 移動到
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {moveTargets(f.path).map((t) => (
              <ContextMenuItem
                key={t.path}
                onSelect={() =>
                  moveItem(
                    { path: f.path, name: f.name, isFolder: true },
                    t.path,
                  )
                }
              >
                {t.label}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem
        onSelect={() => removeFolder(f)}
        className="text-destructive focus:text-destructive"
      >
        <Trash2 className="mr-2 size-4" /> 刪除整個資料夾
      </ContextMenuItem>
    </>
  );

  function RenameBox({
    item,
  }: {
    item: { path: string; name: string; isFolder: boolean };
  }) {
    return (
      <Input
        autoFocus
        value={renameValue}
        onChange={(e) => setRenameValue(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitRename(item);
          if (e.key === "Escape") setRenaming(null);
        }}
        onBlur={() => commitRename(item)}
        className="h-6 w-full px-1 py-0 text-center text-xs"
      />
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl overflow-hidden rounded-xl border bg-background shadow-sm">
      {/* left favorites rail */}
      <aside className="hidden w-48 shrink-0 flex-col gap-0.5 border-r bg-muted/30 p-2 md:flex">
        <div className="px-2 pb-1 pt-1 text-xs font-semibold text-muted-foreground">
          我的空間
        </div>
        <button
          type="button"
          onClick={() => navigate("")}
          className={cn(
            "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted",
            !path && "bg-muted font-medium",
          )}
        >
          <HardDrive className="size-4 text-muted-foreground" /> 全部檔案
        </button>
        {rootFolders.length > 0 && (
          <div className="px-2 pb-1 pt-3 text-xs font-semibold text-muted-foreground">
            資料夾
          </div>
        )}
        <div className="flex flex-col gap-0.5 overflow-y-auto">
          {rootFolders.map((f) => (
            <button
              key={f.path}
              type="button"
              onClick={() => navigate(f.path)}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted",
                (path === f.path || path.startsWith(`${f.path}/`)) &&
                  "bg-muted font-medium",
              )}
            >
              <FolderGlyph /> <span className="truncate">{f.name}</span>
            </button>
          ))}
        </div>
      </aside>

      {/* main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* toolbar */}
        <div className="flex items-center gap-1.5 border-b px-3 py-2">
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
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-sm">
            <button
              type="button"
              onClick={() => navigate("")}
              className={cn(
                "flex items-center gap-1 rounded px-1.5 py-1 hover:bg-muted",
                !path && "font-semibold",
              )}
            >
              <HardDrive className="size-4" /> 檔案總管
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
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              title="新增資料夾"
              onClick={newFolder}
            >
              <FolderPlus className="size-4" />
            </Button>
            <Button
              variant={selectMode ? "secondary" : "outline"}
              size="icon"
              className="size-8"
              title="選取"
              onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
            >
              <ListChecks className="size-4" />
            </Button>
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
              onClick={refresh}
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

        {/* selection bar */}
        {selectMode && (
          <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-sm">
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
            <span className="text-muted-foreground">
              已選 {selected.size} 項
            </span>
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

        {/* body + empty-area context menu */}
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (e.dataTransfer.files?.length)
                  uploadFiles(e.dataTransfer.files);
              }}
              className={cn(
                "min-h-0 flex-1 overflow-y-auto transition-colors",
                dragOver && "bg-primary/5",
              )}
            >
              {isLoading ? (
                <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 size-4 animate-spin" /> 載入中…
                </div>
              ) : failed ? (
                <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                  <span>載入失敗:可能是 DataPilot 檔案服務未連線。</span>
                  <Button variant="outline" size="sm" onClick={refresh}>
                    <RefreshCw className="size-4" /> 重試
                  </Button>
                </div>
              ) : empty ? (
                <div className="flex h-40 flex-col items-center justify-center gap-1 text-sm text-muted-foreground">
                  <Folder className="size-8 opacity-40" />
                  這個資料夾是空的。拖檔案進來、或在空白處按右鍵。
                </div>
              ) : view === "grid" ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(116px,1fr))] gap-1 p-3">
                  {folders.map((f) => (
                    <ContextMenu key={f.path}>
                      <ContextMenuTrigger asChild>
                        <div
                          onClick={() => !renaming && navigate(f.path)}
                          className="group flex w-full min-w-0 cursor-pointer flex-col items-center gap-1.5 rounded-lg p-2 text-center hover:bg-muted"
                        >
                          <FolderGlyph big />
                          {renaming === f.path ? (
                            <RenameBox
                              item={{
                                path: f.path,
                                name: f.name,
                                isFolder: true,
                              }}
                            />
                          ) : (
                            <span className="line-clamp-2 w-full break-all text-xs leading-tight">
                              {f.name}
                            </span>
                          )}
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent>{folderMenu(f)}</ContextMenuContent>
                    </ContextMenu>
                  ))}
                  {files.map((f) => {
                    const sel = selected.has(f.path);
                    return (
                      <ContextMenu key={f.path}>
                        <ContextMenuTrigger asChild>
                          <div
                            onClick={() =>
                              selectMode && !renaming && toggleSelect(f.path)
                            }
                            className={cn(
                              "group relative flex w-full min-w-0 flex-col items-center gap-1.5 rounded-lg p-2 text-center hover:bg-muted",
                              sel && "bg-primary/10 ring-1 ring-primary",
                              selectMode && "cursor-pointer",
                            )}
                          >
                            {selectMode || renaming === f.path ? (
                              <div className="flex w-full min-w-0 flex-col items-center gap-1.5">
                                <FileGlyph file={f} big />
                                {renaming === f.path ? (
                                  <RenameBox
                                    item={{
                                      path: f.path,
                                      name: f.name,
                                      isFolder: false,
                                    }}
                                  />
                                ) : (
                                  <span className="line-clamp-2 w-full break-all text-xs leading-tight">
                                    {f.name}
                                  </span>
                                )}
                              </div>
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
                            {selectMode && (
                              <span className="absolute left-1 top-1">
                                {sel ? (
                                  <SquareCheckBig className="size-4 text-primary" />
                                ) : (
                                  <Square className="size-4 text-muted-foreground" />
                                )}
                              </span>
                            )}
                          </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent>{fileMenu(f)}</ContextMenuContent>
                      </ContextMenu>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col divide-y">
                  {folders.map((f) => (
                    <ContextMenu key={f.path}>
                      <ContextMenuTrigger asChild>
                        <div
                          onClick={() => !renaming && navigate(f.path)}
                          className="group flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted"
                        >
                          <FolderGlyph />
                          {renaming === f.path ? (
                            <RenameBox
                              item={{
                                path: f.path,
                                name: f.name,
                                isFolder: true,
                              }}
                            />
                          ) : (
                            <span className="min-w-0 flex-1 truncate text-sm">
                              {f.name}
                            </span>
                          )}
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent>{folderMenu(f)}</ContextMenuContent>
                    </ContextMenu>
                  ))}
                  {files.map((f) => {
                    const sel = selected.has(f.path);
                    return (
                      <ContextMenu key={f.path}>
                        <ContextMenuTrigger asChild>
                          <div
                            onClick={() =>
                              selectMode && !renaming && toggleSelect(f.path)
                            }
                            className={cn(
                              "group flex items-center gap-3 px-3 py-2 hover:bg-muted",
                              sel && "bg-primary/10",
                              selectMode && "cursor-pointer",
                            )}
                          >
                            {selectMode && (
                              <span className="shrink-0">
                                {sel ? (
                                  <SquareCheckBig className="size-4 text-primary" />
                                ) : (
                                  <Square className="size-4 text-muted-foreground" />
                                )}
                              </span>
                            )}
                            <FileGlyph file={f} />
                            {renaming === f.path ? (
                              <RenameBox
                                item={{
                                  path: f.path,
                                  name: f.name,
                                  isFolder: false,
                                }}
                              />
                            ) : selectMode ? (
                              <span className="min-w-0 flex-1 truncate text-sm">
                                {f.name}
                              </span>
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
                          </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent>{fileMenu(f)}</ContextMenuContent>
                      </ContextMenu>
                    );
                  })}
                </div>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <ArrowDownUp className="mr-2 size-4" /> 排序方式
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {SORT_LABELS.map(([k, label]) => (
                  <ContextMenuItem key={k} onSelect={() => setSort(k)}>
                    <span className="flex-1">{label}</span>
                    {sortBy === k &&
                      (sortDir === "asc" ? (
                        <ArrowUp className="size-4" />
                      ) : (
                        <ArrowDown className="size-4" />
                      ))}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuItem onSelect={refresh}>
              <RefreshCw className="mr-2 size-4" /> 重新整理
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={newFolder}>
              <FolderPlus className="mr-2 size-4" /> 新增資料夾
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => inputRef.current?.click()}>
              <Upload className="mr-2 size-4" /> 上傳到這裡
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        <div className="flex shrink-0 items-center justify-between border-t px-3 py-1.5 text-xs text-muted-foreground">
          <span>
            {folders.length > 0 && `${folders.length} 個資料夾 · `}
            {files.length} 個檔案
          </span>
          <span>
            在項目或空白處按右鍵可用更多功能 · DataPilot 管理,與 AI 助理同步
          </span>
        </div>
      </div>
    </div>
  );
}

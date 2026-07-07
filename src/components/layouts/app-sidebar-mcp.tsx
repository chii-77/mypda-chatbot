"use client";
import { renameMcpCategoryAction } from "@/app/api/mcp/actions";
import { useMcpList } from "@/hooks/queries/use-mcp-list";
import type { MCPServerInfo } from "app-types/mcp";
import { UI_FLAGS } from "lib/ui-flags";
import {
  BrainIcon,
  Check,
  FolderIcon,
  Loader,
  Pencil,
  ServerIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { useSWRConfig } from "swr";
import { safe } from "ts-safe";
import { Button } from "ui/button";
import { Input } from "ui/input";
import { MCPIcon } from "ui/mcp-icon";
import { Popover, PopoverContent, PopoverTrigger } from "ui/popover";
import { handleErrorWithToast } from "ui/shared-toast";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "ui/sidebar";

// Feature panels mounted under a specific MCP server (matched by name). A server
// with panels shows those panels as its sidebar items; a server without panels
// shows its own name (links to its tool-test page).
type Panel = {
  key: string;
  label: string;
  href: string;
  icon: typeof FolderIcon;
};
const SERVER_PANELS: Record<string, Panel[]> = {
  "datapilot-pdf": [
    { key: "files", label: "Files", href: "/files", icon: FolderIcon },
  ],
  // Requests + API Keys are tabs inside the single /memory page.
  "mypda-memory": [
    { key: "memories", label: "Memories", href: "/memory", icon: BrainIcon },
  ],
};

const UNGROUPED = "__ungrouped__";

// Quiet category label. For real (non-ungrouped) groups, a pencil appears on
// hover to rename the whole group (renames every server in it at once).
function CategoryLabel({ groupKey }: { groupKey: string }) {
  const t = useTranslations();
  const { mutate } = useSWRConfig();
  const isUngrouped = groupKey === UNGROUPED;
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(groupKey);
  const [saving, setSaving] = useState(false);

  const save = () =>
    safe(() => setSaving(true))
      .map(() => renameMcpCategoryAction(groupKey, value))
      .ifOk(() => {
        mutate("/api/mcp/list");
        setOpen(false);
      })
      .ifFail(handleErrorWithToast)
      .watch(() => setSaving(false));

  return (
    <div className="group/cat flex items-center px-2 pb-0.5 pt-1">
      <span className="select-none truncate text-xs font-medium text-muted-foreground/70">
        {isUngrouped ? t("MCP.ungrouped") : groupKey}
      </span>
      {!isUngrouped && (
        <Popover
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (o) setValue(groupKey);
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={t("MCP.renameGroup")}
              className="ml-1 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/cat:opacity-100"
            >
              <Pencil className="size-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-60 space-y-2">
            <p className="text-xs font-medium">{t("MCP.renameGroup")}</p>
            <div className="flex items-center gap-1">
              <Input
                value={value}
                autoFocus
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                }}
                className="h-8 text-sm"
              />
              <Button
                size="icon"
                className="size-8 shrink-0"
                disabled={saving || !value.trim()}
                onClick={save}
              >
                {saving ? (
                  <Loader className="size-3 animate-spin" />
                ) : (
                  <Check className="size-3" />
                )}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

// Flat, ChatGPT-style: no expand/collapse. Categories are quiet text labels;
// every server/panel is a flat, full-row-highlight clickable item.
export function AppSidebarMcp() {
  const t = useTranslations();
  const pathname = usePathname();
  const { data: mcpList } = useMcpList();

  // Group servers by their user-defined category; ungrouped go last.
  const groups = useMemo(() => {
    const byCat = new Map<string, MCPServerInfo[]>();
    for (const server of mcpList ?? []) {
      const key = server.category?.trim() ? server.category.trim() : UNGROUPED;
      const list = byCat.get(key) ?? [];
      list.push(server);
      byCat.set(key, list);
    }
    return [...byCat.entries()].sort(([a], [b]) => {
      if (a === UNGROUPED) return 1;
      if (b === UNGROUPED) return -1;
      return a.localeCompare(b);
    });
  }, [mcpList]);

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <Link href="/mcp">
            <SidebarMenuButton
              className="font-semibold"
              isActive={pathname === "/mcp"}
            >
              <MCPIcon className="size-4 fill-accent-foreground" />
              {t("Layout.mcpServers")}
            </SidebarMenuButton>
          </Link>
        </SidebarMenuItem>
      </SidebarMenu>

      {UI_FLAGS.mcpServerList &&
        groups.map(([groupKey, servers]) => (
          <SidebarMenu key={groupKey} className="mt-2">
            <CategoryLabel groupKey={groupKey} />
            {servers.flatMap((server) => {
              const panels = SERVER_PANELS[server.name];
              // No custom panels: the server itself is the item (-> test page).
              if (!panels) {
                const href = `/mcp/test/${server.id}`;
                return [
                  <SidebarMenuItem key={server.id}>
                    <Link href={href}>
                      <SidebarMenuButton isActive={pathname === href}>
                        <ServerIcon className="size-4" />
                        <span className="truncate">{server.name}</span>
                      </SidebarMenuButton>
                    </Link>
                  </SidebarMenuItem>,
                ];
              }
              // Has panels: list each panel as a flat item.
              return panels.map((panel) => {
                const Icon = panel.icon;
                return (
                  <SidebarMenuItem key={`${server.id}-${panel.key}`}>
                    <Link href={panel.href}>
                      <SidebarMenuButton isActive={pathname === panel.href}>
                        <Icon className="size-4" />
                        <span className="truncate">{panel.label}</span>
                      </SidebarMenuButton>
                    </Link>
                  </SidebarMenuItem>
                );
              });
            })}
          </SidebarMenu>
        ))}
    </>
  );
}

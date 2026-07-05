"use client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "ui/dropdown-menu";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "ui/sidebar";
import { SidebarMenu, SidebarMenuItem } from "ui/sidebar";
import { SidebarGroupContent } from "ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";

import { useArchives } from "@/hooks/queries/use-archives";
import { BasicUser } from "app-types/user";
import { Shortcuts, getShortcutKeyList } from "lib/keyboard-shortcuts";
import { UI_FLAGS } from "lib/ui-flags";
import { getIsUserAdmin } from "lib/user/utils";
import {
  FolderOpenIcon,
  FolderSearchIcon,
  MoreHorizontal,
  PlusIcon,
  Shield,
  Waypoints,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { SidebarGroup } from "ui/sidebar";
import { Skeleton } from "ui/skeleton";
import { WriteIcon } from "ui/write-icon";
import { ArchiveDialog } from "../archive-dialog";
import { AppSidebarArtifacts } from "./app-sidebar-artifacts";
import { AppSidebarMcp } from "./app-sidebar-mcp";
import { AppSidebarReplay } from "./app-sidebar-replay";

export function AppSidebarMenus({ user }: { user?: BasicUser }) {
  const router = useRouter();
  const t = useTranslations("");
  const { setOpenMobile } = useSidebar();
  const [expandedArchive, setExpandedArchive] = useState(false);
  const [addArchiveDialogOpen, setAddArchiveDialogOpen] = useState(false);

  const { data: archives, isLoading: isLoadingArchives } = useArchives();
  const toggleArchive = useCallback(() => {
    setExpandedArchive((prev) => !prev);
  }, []);

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          <Tooltip>
            <SidebarMenuItem className="mb-1">
              <Link
                href="/"
                onClick={(e) => {
                  e.preventDefault();
                  setOpenMobile(false);
                  router.push(`/`);
                  router.refresh();
                }}
              >
                <SidebarMenuButton className="flex font-semibold group/new-chat bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground">
                  <WriteIcon className="size-4" />
                  {t("Layout.newChat")}
                  <div className="flex items-center gap-1 text-xs font-medium ml-auto opacity-0 group-hover/new-chat:opacity-100 transition-opacity">
                    {getShortcutKeyList(Shortcuts.openNewChat).map((key) => (
                      <span
                        key={key}
                        className="border border-primary-foreground/20 w-5 h-5 flex items-center justify-center bg-primary-foreground/15 rounded"
                      >
                        {key}
                      </span>
                    ))}
                  </div>
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
          </Tooltip>
        </SidebarMenu>
        {/* MCP servers, flat (no collapse) and grouped by user-defined category
            labels. Files / Memories are server panels. See app-sidebar-mcp.tsx.
            Hidden per docs/DISABLED_FEATURES.md (UI_FLAGS.mcp); /mcp routes stay. */}
        {UI_FLAGS.mcp && <AppSidebarMcp />}
        {/* Global replay/demo conversations (shared across all accounts).
            Hidden per docs/DISABLED_FEATURES.md (UI_FLAGS.replay). */}
        {UI_FLAGS.replay && <AppSidebarReplay />}
        {/* Per-user saved (pinned) MCP Artifacts (UI_FLAGS.savedArtifacts). */}
        {UI_FLAGS.savedArtifacts && <AppSidebarArtifacts />}
        {/* Hidden per docs/DISABLED_FEATURES.md (UI_FLAGS.workflow) */}
        {UI_FLAGS.workflow && (
          <SidebarMenu>
            <Tooltip>
              <SidebarMenuItem>
                <Link href="/workflow">
                  <SidebarMenuButton className="font-semibold">
                    <Waypoints className="size-4" />
                    {t("Layout.workflow")}
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
            </Tooltip>
          </SidebarMenu>
        )}
        {/* Overflow menu (ChatGPT-style "More" flyout). Admin lives here now;
            future low-traffic items go here too. */}
        {getIsUserAdmin(user) && (
          <SidebarMenu className="mt-2">
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton className="font-medium">
                    <MoreHorizontal className="size-4" />
                    {t("Layout.more")}
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="right"
                  align="start"
                  className="w-48"
                >
                  <DropdownMenuItem asChild className="cursor-pointer">
                    <Link href="/admin" data-testid="admin-sidebar-link">
                      <Shield className="mr-2 size-4" />
                      {t("Admin.title")}
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
        {/* Hidden per docs/DISABLED_FEATURES.md (UI_FLAGS.archive) */}
        {UI_FLAGS.archive && (
          <SidebarMenu className="group/archive">
            <Tooltip>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={toggleArchive}
                  className="font-semibold"
                >
                  {expandedArchive ? (
                    <FolderOpenIcon className="size-4" />
                  ) : (
                    <FolderSearchIcon className="size-4" />
                  )}
                  {t("Archive.title")}
                </SidebarMenuButton>
                <SidebarMenuAction
                  className="group-hover/archive:opacity-100 opacity-0 transition-opacity"
                  onClick={() => setAddArchiveDialogOpen(true)}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <PlusIcon className="size-4" />
                    </TooltipTrigger>
                    <TooltipContent side="right" align="center">
                      {t("Archive.addArchive")}
                    </TooltipContent>
                  </Tooltip>
                </SidebarMenuAction>
              </SidebarMenuItem>
            </Tooltip>
            {expandedArchive && (
              <>
                <SidebarMenuSub>
                  {isLoadingArchives ? (
                    <div className="gap-2 flex flex-col">
                      {Array.from({ length: 2 }).map((_, index) => (
                        <Skeleton key={index} className="h-6 w-full" />
                      ))}
                    </div>
                  ) : archives!.length === 0 ? (
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton className="text-muted-foreground">
                        {t("Archive.noArchives")}
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ) : (
                    archives!.map((archive) => (
                      <SidebarMenuSubItem
                        onClick={() => {
                          router.push(`/archive/${archive.id}`);
                        }}
                        key={archive.id}
                        className="cursor-pointer"
                      >
                        <SidebarMenuSubButton>
                          {archive.name}
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))
                  )}
                </SidebarMenuSub>
              </>
            )}
          </SidebarMenu>
        )}
      </SidebarGroupContent>
      {UI_FLAGS.archive && (
        <ArchiveDialog
          open={addArchiveDialogOpen}
          onOpenChange={setAddArchiveDialogOpen}
        />
      )}
    </SidebarGroup>
  );
}

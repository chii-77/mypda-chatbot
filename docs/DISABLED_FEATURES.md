# Disabled / Hidden UI Features

This fork hides some of upstream better-chatbot's UI per product decisions.
**Nothing is deleted** — each feature is only hidden so it can be restored
later. This file is the registry: what is off, why, where it lives, and how to
bring it back.

Mechanism: a single flag set in `src/lib/ui-flags.ts` (a "feature flag" style
switch). Each entry point renders only when its flag is `true`, so restoring a
feature = **flip its flag back to `true`** in that file. The "Where it renders"
column points at the exact site each flag guards.

Status legend: `requested` = decided, not yet applied · `hidden (<date>)` =
currently gated off and not rendered in the UI.

Applied: 2026-06-18 — all five flags set to `false` in `src/lib/ui-flags.ts`.

## Registry

| # | Feature | Where it renders | Flag | Status |
|---|---------|------------------|------|--------|
| 1 | Sidebar「工作流 / Workflow」link + Tools-dropdown 工作流 submenu | `app-sidebar-menus.tsx` (`<Link href="/workflow">`) and `tool-select-dropdown.tsx` (`<WorkflowToolSelector/>`) | `workflow` | hidden (2026-06-18) |
| 2 | 封存 / 归档 / Archive — sidebar section + thread-dropdown「新增到歸檔」 | `app-sidebar-menus.tsx` (`group/archive` block + `<ArchiveDialog>`) and `thread-dropdown.tsx` (the 新增到歸檔 `CommandItem`) | `archive` | hidden (2026-06-18) |
| 3 | Sidebar「智能體 / Agents」list + 「創建智能體 / Create an agent」card + Tools-dropdown 智慧體 submenu | `<AppSidebarAgents/>` in `app-sidebar.tsx`, and `<AgentSelector/>` in `tool-select-dropdown.tsx` | `agents` | hidden (2026-06-18) |
| 4 | User menu「報告問題 / Report an issue」 | `src/components/layouts/app-sidebar-user.tsx` — the `reportAnIssue` dropdown item (opens GitHub issues) | `reportIssue` | hidden (2026-06-18) |
| 5 | User menu「加入社區 / Join community」 | `src/components/layouts/app-sidebar-user.tsx` — the `joinCommunity` dropdown item (opens Discord) | `joinCommunity` | hidden (2026-06-18) |
| 6 | 語音聊天 / Voice chat (header button + chat-input button) | `app-header.tsx` (top-right `AudioWaveformIcon`) and `prompt-input.tsx` (input `AudioWaveformIcon`, tooltip 語音聊天模式) | `voiceChat` | hidden (2026-06-18) |
| 7 | Header「切換臨時聊天 / Toggle temporary chat」 | `src/components/layouts/app-header.tsx` — the top-right `MessageCircleDashed` button | `temporaryChat` | hidden (2026-06-18) |
| 8 | Ambient light-rays / particles animations (platform-wide) | Gated at the components `src/components/ui/light-rays.tsx` + `src/components/ui/particles.tsx` (return null). Covers chat idle effect, /mcp dashboard, archive page, auth-error page, export preview | `ambientAnimations` | hidden (2026-06-18) |
| 9 | Tools dropdown「生成圖片 / Generate image」submenu | `src/components/tool-select-dropdown.tsx` — `<ImageGeneratorSelector/>` | `imageGeneration` | hidden (2026-06-18) |
| 10 | Tools dropdown「預設 / Presets」submenu | `src/components/tool-select-dropdown.tsx` — `<ToolPresets/>` | `toolPresets` | hidden (2026-06-18) |
| 11 | Tools dropdown「網頁搜尋 / Web search」toggle | `src/components/tool-select-dropdown.tsx` — `AppDefaultToolKitSelector` (WebSearch toolkit) | `webSearch` | hidden (2026-06-18) |
| 12 | Tools dropdown「Code Execution」toggle | `src/components/tool-select-dropdown.tsx` — `AppDefaultToolKitSelector` (Code toolkit) | `codeExecution` | hidden (2026-06-18) |
| 13 | Tools dropdown「HTTP Request」toggle | `src/components/tool-select-dropdown.tsx` — `AppDefaultToolKitSelector` (Http toolkit) | `httpRequest` | hidden (2026-06-18) |
| 14 | Sidebar「MCP 伺服器管理 / MCP servers」list section | `app-sidebar-menus.tsx` (`<AppSidebarMcp/>`) | `mcp` | hidden (2026-07-06) |
| 15 | Sidebar「重播 / Replay」demo list + admin thread-dropdown「新增到重播」entry | `app-sidebar-menus.tsx` (`<AppSidebarReplay/>`) and `thread-dropdown.tsx` (the `handleAddToReplay` `CommandItem`) | `replay` | hidden (2026-07-06) |

## Details & restore notes

1. **Workflow link** — entry point to `/workflow`. Hiding only removes the
   sidebar link; the `/workflow` route still works if visited directly.
2. **Archive section** — the collapsible "Archive" group plus its add-archive
   dialog. Archive routes (`/archive/:id`) remain functional.
3. **Agents + Create an agent** — `<AppSidebarAgents/>` renders both the
   "Agents" list and the "Create an agent" card; hiding the component removes
   both. `/agents` and `/agent/new` routes remain functional.
4. **Report an issue** — links to the upstream GitHub issues page; not relevant
   for this private deployment.
5. **Join community** — links to the upstream Discord; not relevant here.
6. **Voice chat** — both entry points are hidden: the top-right header button
   and the voice button inside the chat input (tooltip 語音聊天模式). The voice
   chat feature/store is otherwise untouched.
7. **Toggle temporary chat** — top-right header button that toggles temporary
   (non-persisted) chat mode. Hidden; the feature itself is untouched.
8. **Ambient animations (platform-wide)** — the `LightRays` and `Particles`
   WebGL effects (the "flickering light" seen in the chat idle state, on the
   /mcp dashboard, the archive page, the auth-error page and the export
   preview). Both components now return `null` when the flag is off, so every
   usage — current or future — is covered in one place.
14. **MCP servers sidebar section** — `<AppSidebarMcp/>` (the「MCP 伺服器管理」
   list of connected servers that link to the `/mcp/test/[id]` tester). Only
   the sidebar entry point is hidden; the `/mcp` dashboard, the
   `/mcp/test/[id]` tool-tester pages and their API routes all remain reachable
   directly. Restore = flip `mcp` back to `true`.
15. **Replay** — the「重播」demo-conversation list in the sidebar
   (`<AppSidebarReplay/>`) plus the admin-only「新增到重播」item in the thread
   dropdown (`handleAddToReplay`). Both entry points are hidden. The
   `/replay/[id]` viewer route, the `/api/replays` API and the `mcp` replay DB
   table are intentionally left intact (no migration, prod-boot safe), so
   existing replay links still resolve if visited directly. Restore = flip
   `replay` back to `true`.

## Important

- Items 9–13 hide entries in the chat **Tools dropdown** only. For the toggles
  (web search / code execution / HTTP request) this removes the switch from the
  UI but does not forcibly clear whatever is already in
  `allowedAppDefaultToolkit` — it is a UI-visibility change, consistent with the
  rest of this list.
- These are **UI-only** hides. Backend routes and APIs are untouched, so the
  features still work if a URL is visited directly. Only the entry points are
  hidden.
- To restore: flip the flag in `src/lib/ui-flags.ts` (once added), or
  un-hide the block at the Location above.
- Keep this table in sync with `src/lib/ui-flags.ts` whenever a feature is
  hidden or restored.

Last updated: 2026-06-18

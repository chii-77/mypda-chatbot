// Feature flags for hiding upstream better-chatbot UI we don't want in this
// deployment. `false` = hidden; flip to `true` to restore the feature.
// Keep this in sync with docs/DISABLED_FEATURES.md.
export const UI_FLAGS = {
  // Sidebar「工作流 / Workflow」link
  workflow: false,
  // Sidebar「封存 / 归档 / Archive」section
  archive: false,
  // Sidebar「智能體 / Agents」list + 「創建智能體 / Create an agent」card
  agents: false,
  // Sidebar「MCP 伺服器管理 / MCP servers」list section. Hidden from the
  // sidebar per product decision; the /mcp dashboard and /mcp/test/[id]
  // tester routes + API remain fully functional if visited directly.
  mcp: false,
  // Sidebar「重播 / Replay」demo-conversation list + the admin thread-dropdown
  // 「新增到重播 / Add to replay」entry. Hidden per product decision; the
  // /replay/[id] viewer route, /api/replays API and DB table are left intact.
  replay: false,
  // User menu「報告問題 / Report an issue」
  reportIssue: false,
  // User menu「加入社區 / Join community」
  joinCommunity: false,
  // Header「切換語音聊天 / Toggle voice chat」button
  voiceChat: false,
  // Header「切換臨時聊天 / Toggle temporary chat」button
  temporaryChat: false,
  // All ambient light-rays / particles animations platform-wide (chat idle
  // effect, /mcp dashboard, archive page, auth-error page, export preview).
  // Gated at the LightRays/Particles components themselves, so every usage is
  // covered. false = no ambient animation anywhere.
  ambientAnimations: false,
  // Tools dropdown「生成圖片 / Generate image」submenu
  imageGeneration: false,
  // Tools dropdown「預設 / Presets」submenu
  toolPresets: false,
  // Tools dropdown「網頁搜尋 / Web search」toggle
  webSearch: false,
  // Tools dropdown「Code Execution」toggle
  codeExecution: false,
  // Tools dropdown「HTTP Request」toggle
  httpRequest: false,
  // Tools dropdown「MCP Artifacts」toggle (new feature, shown by default)
  mcpArtifacts: true,
  // Sidebar「已釘選的 Artifact / Saved artifacts」section + pin button on
  // artifacts (new feature, shown by default).
  savedArtifacts: true,
} as const;

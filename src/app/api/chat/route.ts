import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  smoothStream,
  stepCountIs,
  streamText,
  Tool,
  UIMessage,
} from "ai";

import { customModelProvider, isToolCallUnsupportedModel } from "lib/ai/models";

import { agentRepository, chatRepository } from "lib/db/repository";
import globalLogger from "logger";
import {
  buildMcpServerCustomizationsSystemPrompt,
  buildMcpServerInstructionsSystemPrompt,
  buildMcpArtifactSystemPrompt,
  buildUserSystemPrompt,
  buildToolCallUnsupportedModelSystemPrompt,
} from "lib/ai/prompts";
import { mcpClientsManager } from "lib/ai/mcp/mcp-manager";
import {
  chatApiSchemaRequestBodySchema,
  ChatMention,
  ChatMetadata,
} from "app-types/chat";

import { errorIf, safe } from "ts-safe";

import {
  excludeToolExecution,
  handleError,
  manualToolExecuteByLastMessage,
  mergeSystemPrompt,
  extractInProgressToolPart,
  filterMcpServerCustomizations,
  loadMcpTools,
  loadWorkFlowTools,
  loadAppDefaultTools,
  convertToSavePart,
} from "./shared.chat";
import {
  rememberAgentAction,
  rememberMcpServerCustomizationsAction,
} from "./actions";
import { getSession } from "auth/server";
import { colorize } from "consola/utils";
import { generateUUID } from "lib/utils";
import { nanoBananaTool, openaiImageTool } from "lib/ai/tools/image";
import { DefaultToolName, ImageToolName } from "lib/ai/tools";
import { buildCsvIngestionPreviewParts } from "@/lib/ai/ingest/csv-ingest";
import { serverFileStorage } from "lib/file-storage";
import { storageKeyFromUrl } from "@/lib/file-storage/storage-utils";
import type { ChatAttachment } from "app-types/chat";

const logger = globalLogger.withDefaults({
  message: colorize("blackBright", `Chat API: `),
});

// Note: the Code runtime (OpenCode) streams browser-direct from the OpenCode
// bridge (see lib/ai/opencode-runtime.ts), NOT through this route — so no long
// serverless duration is needed here. This route stays on Vercel defaults.

/**
 * Code runtime: forward the user's prompt to the OpenCode backend (bridge
 * `/run` SSE endpoint) with the current user's identity, and stream the
 * progress + final result into the chat message as text. Deterministic — no
 * chat LLM orchestrating. Requires env OPENCODE_RUN_URL (+ OPENCODE_RUN_TOKEN).
 */
// Upload limits when feeding attachments into the OpenCode workspace.
const OPENCODE_MAX_FILES = 20;
const OPENCODE_MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB per file
const OPENCODE_MAX_TOTAL_BYTES = 15 * 1024 * 1024; // 15 MB total

/** Download the chat attachments and encode them for the OpenCode workspace. */
async function collectOpenCodeFiles(
  attachments: ChatAttachment[],
): Promise<{ name: string; content_b64: string }[]> {
  const out: { name: string; content_b64: string }[] = [];
  let total = 0;
  for (const att of attachments) {
    if (out.length >= OPENCODE_MAX_FILES) break;
    const key = storageKeyFromUrl(att.url);
    if (!key) continue; // external source-url (not our storage) → skip
    try {
      const buf = await serverFileStorage.download(key);
      if (buf.length > OPENCODE_MAX_FILE_BYTES) continue;
      if (total + buf.length > OPENCODE_MAX_TOTAL_BYTES) break;
      total += buf.length;
      out.push({
        name: att.filename || key.split("/").pop() || "file",
        content_b64: buf.toString("base64"),
      });
    } catch {
      // not in our storage / download failed → skip
    }
  }
  return out;
}

async function streamOpenCodeRuntime({
  dataStream,
  userText,
  attachments,
  user,
  signal,
}: {
  dataStream: {
    write: (chunk: any) => void;
  };
  userText: string;
  attachments: ChatAttachment[];
  user: { id: string; email?: string | null; name?: string | null };
  signal?: AbortSignal;
}) {
  const textId = generateUUID();
  dataStream.write({ type: "text-start", id: textId });
  const write = (delta: string) =>
    dataStream.write({ type: "text-delta", id: textId, delta });
  const end = () => dataStream.write({ type: "text-end", id: textId });

  const runUrl = process.env.OPENCODE_RUN_URL;
  const runToken = process.env.OPENCODE_RUN_TOKEN;
  if (!runUrl) {
    write("⚠️ Code 模式尚未設定(伺服器缺少 OPENCODE_RUN_URL)。");
    return end();
  }
  if (!userText) {
    write("請輸入要 OpenCode 產生或修改的內容。");
    return end();
  }

  const files = attachments?.length
    ? await collectOpenCodeFiles(attachments)
    : [];

  try {
    const res = await fetch(`${runUrl.replace(/\/$/, "")}/run`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(runToken ? { authorization: `Bearer ${runToken}` } : {}),
        "x-mypda-user-id": user.id,
        "x-mypda-email": user.email || "",
        "x-mypda-role": (user as { role?: string }).role || "",
        "x-mypda-name": user.name || "",
      },
      body: JSON.stringify({ prompt: userText, files }),
      signal,
    });
    if (!res.ok || !res.body) {
      write(`⚠️ OpenCode 後端錯誤(HTTP ${res.status})。`);
      return end();
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let gotResult = false;
    // artifact.html this run produced/changed (rendered after the text part)
    let artifact: { html: string; diff?: string } | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(line.indexOf(":") + 1).trim();
        if (!payload) continue;
        let evt: any;
        try {
          evt = JSON.parse(payload);
        } catch {
          continue;
        }
        if (evt.type === "progress") {
          write(`> ${evt.message}\n`);
        } else if (evt.type === "result") {
          gotResult = true;
          write(
            evt.status === "done"
              ? `\n${evt.text || "(無內容)"}\n`
              : `\n⚠️ 失敗:${evt.error || "unknown"}\n`,
          );
          if (evt.status === "done" && evt.artifact?.html) {
            artifact = evt.artifact;
            // Show the line-level diff for edits (empty for a brand-new one).
            if (evt.artifact.diff?.trim()) {
              write(
                `\n**變更(diff):**\n\`\`\`diff\n${evt.artifact.diff}\`\`\`\n`,
              );
            }
          }
        } else if (evt.type === "error") {
          write(`\n⚠️ ${evt.error || "unknown"}\n`);
        }
      }
    }
    if (!gotResult) write("\n(連線結束,未取得結果)\n");
    end(); // close the text part first
    // Then render the artifact as the SAME interactive component myPDA uses —
    // an output-available `create_mcp_artifact` tool part built from its input.
    if (artifact?.html) {
      const toolCallId = generateUUID();
      dataStream.write({
        type: "tool-input-available",
        toolCallId,
        toolName: DefaultToolName.CreateMcpArtifact,
        input: {
          title: "OpenCode Artifact",
          description: null,
          html: artifact.html,
          allowedServers: null,
        },
      });
      dataStream.write({
        type: "tool-output-available",
        toolCallId,
        output: "Artifact created.",
      });
    }
    return;
  } catch (e: any) {
    write(`\n⚠️ OpenCode 連線失敗:${e?.message || e}\n`);
    end();
  }
}

export async function POST(request: Request) {
  try {
    const json = await request.json();

    const session = await getSession();

    if (!session?.user.id) {
      return new Response("Unauthorized", { status: 401 });
    }
    const {
      id,
      message,
      chatModel,
      toolChoice,
      runtime = "normal",
      allowedAppDefaultToolkit,
      allowedMcpServers,
      imageTool,
      mentions = [],
      attachments = [],
    } = chatApiSchemaRequestBodySchema.parse(json);

    const model = customModelProvider.getModel(chatModel);

    let thread = await chatRepository.selectThreadDetails(id);

    if (!thread) {
      logger.info(`create chat thread: ${id}`);
      const newThread = await chatRepository.insertThread({
        id,
        title: "",
        userId: session.user.id,
      });
      thread = await chatRepository.selectThreadDetails(newThread.id);
    }

    if (thread!.userId !== session.user.id) {
      return new Response("Forbidden", { status: 403 });
    }

    const messages: UIMessage[] = (thread?.messages ?? []).map((m) => {
      return {
        id: m.id,
        role: m.role,
        parts: m.parts,
        metadata: m.metadata,
      };
    });

    if (messages.at(-1)?.id == message.id) {
      messages.pop();
    }
    const ingestionPreviewParts = await buildCsvIngestionPreviewParts(
      attachments,
      (key) => serverFileStorage.download(key),
    );
    if (ingestionPreviewParts.length) {
      const baseParts = [...message.parts];
      let insertionIndex = -1;
      for (let i = baseParts.length - 1; i >= 0; i -= 1) {
        if (baseParts[i]?.type === "text") {
          insertionIndex = i;
          break;
        }
      }
      if (insertionIndex !== -1) {
        baseParts.splice(insertionIndex, 0, ...ingestionPreviewParts);
        message.parts = baseParts;
      } else {
        message.parts = [...baseParts, ...ingestionPreviewParts];
      }
    }

    if (attachments.length) {
      const firstTextIndex = message.parts.findIndex(
        (part: any) => part?.type === "text",
      );
      const attachmentParts: any[] = [];

      attachments.forEach((attachment) => {
        const exists = message.parts.some(
          (part: any) =>
            part?.type === attachment.type && part?.url === attachment.url,
        );
        if (exists) return;

        if (attachment.type === "file") {
          attachmentParts.push({
            type: "file",
            url: attachment.url,
            mediaType: attachment.mediaType,
            filename: attachment.filename,
          });
        } else if (attachment.type === "source-url") {
          attachmentParts.push({
            type: "source-url",
            url: attachment.url,
            mediaType: attachment.mediaType,
            title: attachment.filename,
          });
        }
      });

      if (attachmentParts.length) {
        if (firstTextIndex >= 0) {
          message.parts = [
            ...message.parts.slice(0, firstTextIndex),
            ...attachmentParts,
            ...message.parts.slice(firstTextIndex),
          ];
        } else {
          message.parts = [...message.parts, ...attachmentParts];
        }
      }
    }

    messages.push(message);

    const supportToolCall = !isToolCallUnsupportedModel(model);

    const agentId = (
      mentions.find((m) => m.type === "agent") as Extract<
        ChatMention,
        { type: "agent" }
      >
    )?.agentId;

    const agent = await rememberAgentAction(agentId, session.user.id);

    if (agent?.instructions?.mentions) {
      mentions.push(...agent.instructions.mentions);
    }

    const useImageTool = Boolean(imageTool?.model);

    const isToolCallAllowed =
      supportToolCall &&
      (toolChoice != "none" || mentions.length > 0) &&
      !useImageTool;

    const metadata: ChatMetadata = {
      agentId: agent?.id,
      toolChoice: toolChoice,
      toolCount: 0,
      chatModel: chatModel,
    };

    const stream = createUIMessageStream({
      execute: async ({ writer: dataStream }) => {
        // ── Code runtime (OpenCode) ──────────────────────────────────────
        // When the "⚙️ Code" switch is on, DON'T run the LLM+tools loop.
        // Route the user's message straight to the OpenCode backend and stream
        // its progress + result into this same chat message. No chat-LLM in the
        // loop → no double-agent, no polling.
        if (runtime === "code") {
          metadata.chatModel = { provider: "opencode", model: "code-runtime" };
          await streamOpenCodeRuntime({
            dataStream,
            userText: message.parts
              .filter((p: any) => p?.type === "text")
              .map((p: any) => p.text)
              .join("\n")
              .trim(),
            attachments,
            user: session.user,
            signal: request.signal,
          });
          return;
        }

        const MCP_TOOLS = await safe()
          .map(errorIf(() => !isToolCallAllowed && "Not allowed"))
          .map(() =>
            loadMcpTools({
              mentions,
              allowedMcpServers,
            }),
          )
          .orElse({});

        const WORKFLOW_TOOLS = await safe()
          .map(errorIf(() => !isToolCallAllowed && "Not allowed"))
          .map(() =>
            loadWorkFlowTools({
              mentions,
              dataStream,
            }),
          )
          .orElse({});

        const APP_DEFAULT_TOOLS = await safe()
          .map(errorIf(() => !isToolCallAllowed && "Not allowed"))
          .map(() =>
            loadAppDefaultTools({
              mentions,
              allowedAppDefaultToolkit,
            }),
          )
          .orElse({});
        const inProgressToolParts = extractInProgressToolPart(message);
        if (inProgressToolParts.length) {
          await Promise.all(
            inProgressToolParts.map(async (part) => {
              const output = await manualToolExecuteByLastMessage(
                part,
                { ...MCP_TOOLS, ...WORKFLOW_TOOLS, ...APP_DEFAULT_TOOLS },
                request.signal,
              );
              part.output = output;

              dataStream.write({
                type: "tool-output-available",
                toolCallId: part.toolCallId,
                output,
              });
            }),
          );
        }

        const userPreferences = thread?.userPreferences || undefined;

        const mcpServerCustomizations = await safe()
          .map(() => {
            if (Object.keys(MCP_TOOLS ?? {}).length === 0)
              throw new Error("No tools found");
            return rememberMcpServerCustomizationsAction(session.user.id);
          })
          .map((v) => filterMcpServerCustomizations(MCP_TOOLS!, v))
          .orElse({});

        // Server-declared instructions (MCP protocol `instructions`) for the
        // servers whose tools are active in this request. Distinct from the
        // user-authored customizations above.
        const mcpServerInstructions = await safe(async () => {
          const activeServerIds = new Set(
            Object.values(MCP_TOOLS ?? {}).map((t) => t._mcpServerId),
          );
          if (activeServerIds.size === 0) return {};
          const clients = await mcpClientsManager.getClients();
          return clients.reduce<Record<string, string>>((acc, { client }) => {
            const info = client.getInfo();
            if (activeServerIds.has(info.id) && info.instructions?.trim()) {
              acc[info.name] = info.instructions;
            }
            return acc;
          }, {});
        }).orElse({});

        // MCP Artifacts: when the artifact tool is active, give the model the
        // window.mcp API + a menu of MCP servers/tools to build artifacts
        // against. Built from MCP_TOOLS, which is already filtered by the chat's
        // allowedMcpServers / mentions — so artifacts only ever target servers
        // enabled in this chat, same scope as direct tool use.
        const mcpArtifactPrompt = safe(() => {
          if (!APP_DEFAULT_TOOLS?.[DefaultToolName.CreateMcpArtifact])
            return "";
          const byServer: Record<
            string,
            { name: string; description?: string }[]
          > = {};
          for (const t of Object.values(MCP_TOOLS ?? {})) {
            const serverName = t._mcpServerName;
            if (!serverName) continue;
            (byServer[serverName] ??= []).push({
              name: t._originToolName,
              description: t.description,
            });
          }
          const servers = Object.entries(byServer).map(([name, tools]) => ({
            name,
            tools,
          }));
          return buildMcpArtifactSystemPrompt(servers);
        }).orElse("");

        const systemPrompt = mergeSystemPrompt(
          buildUserSystemPrompt(session.user, userPreferences, agent),
          buildMcpServerInstructionsSystemPrompt(mcpServerInstructions),
          buildMcpServerCustomizationsSystemPrompt(mcpServerCustomizations),
          mcpArtifactPrompt,
          !supportToolCall && buildToolCallUnsupportedModelSystemPrompt,
        );

        const IMAGE_TOOL: Record<string, Tool> = useImageTool
          ? {
              [ImageToolName]:
                imageTool?.model === "google"
                  ? nanoBananaTool
                  : openaiImageTool,
            }
          : {};
        const vercelAITooles = safe({
          ...MCP_TOOLS,
          ...WORKFLOW_TOOLS,
        })
          .map((t) => {
            const bindingTools =
              toolChoice === "manual" ||
              (message.metadata as ChatMetadata)?.toolChoice === "manual"
                ? excludeToolExecution(t)
                : t;
            return {
              ...bindingTools,
              ...APP_DEFAULT_TOOLS, // APP_DEFAULT_TOOLS Not Supported Manual
              ...IMAGE_TOOL,
            };
          })
          .unwrap();
        metadata.toolCount = Object.keys(vercelAITooles).length;

        const allowedMcpTools = Object.values(allowedMcpServers ?? {})
          .map((t) => t.tools)
          .flat();

        logger.info(
          `${agent ? `agent: ${agent.name}, ` : ""}tool mode: ${toolChoice}, mentions: ${mentions.length}`,
        );

        logger.info(
          `allowedMcpTools: ${allowedMcpTools.length ?? 0}, allowedAppDefaultToolkit: ${allowedAppDefaultToolkit?.length ?? 0}`,
        );
        if (useImageTool) {
          logger.info(`binding tool count Image: ${imageTool?.model}`);
        } else {
          logger.info(
            `binding tool count APP_DEFAULT: ${Object.keys(APP_DEFAULT_TOOLS ?? {}).length}, MCP: ${Object.keys(MCP_TOOLS ?? {}).length}, Workflow: ${Object.keys(WORKFLOW_TOOLS ?? {}).length}`,
          );
        }
        logger.info(`model: ${chatModel?.provider}/${chatModel?.model}`);

        const result = streamText({
          model,
          system: systemPrompt,
          messages: convertToModelMessages(messages),
          experimental_transform: smoothStream({ chunking: "word" }),
          maxRetries: 2,
          tools: vercelAITooles,
          stopWhen: stepCountIs(10),
          toolChoice: "auto",
          abortSignal: request.signal,
        });
        result.consumeStream();
        dataStream.merge(
          result.toUIMessageStream({
            messageMetadata: ({ part }) => {
              if (part.type == "finish") {
                metadata.usage = part.totalUsage;
                return metadata;
              }
            },
          }),
        );
      },

      generateId: generateUUID,
      onFinish: async ({ responseMessage }) => {
        if (responseMessage.id == message.id) {
          await chatRepository.upsertMessage({
            threadId: thread!.id,
            ...responseMessage,
            parts: responseMessage.parts.map(convertToSavePart),
            metadata,
          });
        } else {
          await chatRepository.upsertMessage({
            threadId: thread!.id,
            role: message.role,
            parts: message.parts.map(convertToSavePart),
            id: message.id,
          });
          await chatRepository.upsertMessage({
            threadId: thread!.id,
            role: responseMessage.role,
            id: responseMessage.id,
            parts: responseMessage.parts.map(convertToSavePart),
            metadata,
          });
        }

        if (agent) {
          agentRepository.updateAgent(agent.id, session.user.id, {
            updatedAt: new Date(),
          } as any);
        }
      },
      onError: handleError,
      originalMessages: messages,
    });

    return createUIMessageStreamResponse({
      stream,
    });
  } catch (error: any) {
    logger.error(error);
    return Response.json({ message: error.message }, { status: 500 });
  }
}

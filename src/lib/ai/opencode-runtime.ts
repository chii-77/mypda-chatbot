import {
  DefaultChatTransport,
  type ChatTransport,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { generateUUID } from "lib/utils";
import { DefaultToolName } from "lib/ai/tools";

/**
 * "Code runtime" transport (browser-direct).
 *
 * In Code mode the browser streams straight from the OpenCode bridge instead of
 * going through /api/chat — this sidesteps Vercel's serverless function-duration
 * limit (the long OpenCode job runs against the VM, not a Vercel function).
 *
 * Flow: fetch a short-lived signed token from /api/opencode/token, then POST to
 * the bridge /run with it and adapt the bridge's SSE events into the AI SDK
 * UIMessageChunk stream that useChat renders — so the chat UI is unchanged.
 */

const MAX_FILES = 20;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 15 * 1024 * 1024;

function base64FromBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** Download the user's attachments in the browser and encode for the workspace. */
async function collectFiles(
  message: UIMessage | undefined,
): Promise<{ name: string; content_b64: string }[]> {
  const out: { name: string; content_b64: string }[] = [];
  if (!message) return out;
  let total = 0;
  for (const part of message.parts as any[]) {
    if (part?.type !== "file" || !part?.url) continue;
    if (out.length >= MAX_FILES) break;
    try {
      const r = await fetch(part.url);
      if (!r.ok) continue;
      const buf = await r.arrayBuffer();
      if (buf.byteLength > MAX_FILE_BYTES) continue;
      if (total + buf.byteLength > MAX_TOTAL_BYTES) break;
      total += buf.byteLength;
      out.push({
        name: part.filename || "file",
        content_b64: base64FromBuffer(buf),
      });
    } catch {
      // cross-origin / fetch failure → skip
    }
  }
  return out;
}

function extractText(message: UIMessage | undefined): string {
  if (!message) return "";
  return (message.parts as any[])
    .filter((p) => p?.type === "text")
    .map((p) => p.text)
    .join("\n")
    .trim();
}

/** Build the UIMessageChunk stream for a Code-runtime turn. */
function codeRuntimeStream(
  messages: UIMessage[],
  abortSignal: AbortSignal | undefined,
): ReadableStream<UIMessageChunk> {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const prompt = extractText(lastUser);

  return new ReadableStream<UIMessageChunk>({
    async start(controller) {
      const textId = generateUUID();
      const write = (delta: string) =>
        controller.enqueue({ type: "text-delta", id: textId, delta });
      let artifact: { html: string; diff?: string } | null = null;

      controller.enqueue({ type: "start" });
      controller.enqueue({ type: "text-start", id: textId });
      try {
        if (!prompt) {
          write("請輸入要 OpenCode 產生或修改的內容。");
          throw new Error("empty prompt");
        }
        const tokRes = await fetch("/api/opencode/token", { method: "POST" });
        if (!tokRes.ok) {
          write("⚠️ 無法取得 Code 憑證(請確認已登入 / 伺服器已設定)。");
          throw new Error("token failed");
        }
        const { token, url } = await tokRes.json();
        const files = await collectFiles(lastUser);

        const res = await fetch(`${url}/run`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ prompt, files }),
          signal: abortSignal,
        });
        if (!res.ok || !res.body) {
          write(`⚠️ OpenCode 後端錯誤(HTTP ${res.status})。`);
          throw new Error("run failed");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
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
              write(
                evt.status === "done"
                  ? `\n${evt.text || "(無內容)"}\n`
                  : `\n⚠️ 失敗:${evt.error || "unknown"}\n`,
              );
              if (evt.status === "done" && evt.artifact?.html) {
                artifact = evt.artifact;
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
      } catch (e: any) {
        if (e?.name !== "AbortError" && e?.message === undefined) {
          write(`\n⚠️ ${e}`);
        }
      } finally {
        controller.enqueue({ type: "text-end", id: textId });
        if (artifact?.html) {
          const toolCallId = generateUUID();
          controller.enqueue({
            type: "tool-input-available",
            toolCallId,
            toolName: DefaultToolName.CreateMcpArtifact,
            input: {
              title: "OpenCode Artifact",
              description: null,
              html: artifact.html,
              allowedServers: null,
            },
          } as UIMessageChunk);
          controller.enqueue({
            type: "tool-output-available",
            toolCallId,
            output: "Artifact created.",
          } as UIMessageChunk);
        }
        controller.enqueue({ type: "finish" });
        controller.close();
      }
    },
  });
}

/**
 * Wrap DefaultChatTransport: normal runtime → default (POST /api/chat);
 * code runtime → browser-direct bridge stream. getRuntime is read per-send.
 */
export function createChatTransport(
  baseOptions: ConstructorParameters<typeof DefaultChatTransport>[0],
  getRuntime: () => "normal" | "code",
): ChatTransport<UIMessage> {
  const base = new DefaultChatTransport<UIMessage>(baseOptions);
  return {
    sendMessages(options) {
      if (getRuntime() === "code") {
        return Promise.resolve(
          codeRuntimeStream(options.messages, options.abortSignal),
        );
      }
      return base.sendMessages(options);
    },
    reconnectToStream(options) {
      return base.reconnectToStream(options);
    },
  };
}

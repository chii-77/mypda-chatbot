"use client";

import { appStore } from "@/app/store";
import { MessageCircle, Code2 } from "lucide-react";
import { Button } from "ui/button";
import { useShallow } from "zustand/shallow";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { cn } from "lib/utils";

/**
 * Runtime switch on the chat input row:
 *   💬 Chat  = Better Chatbot (LLM + tools, the normal platform)
 *   ⚙️ Code  = OpenCode (messages routed straight to the OpenCode backend)
 *
 * Same UI, same tools — only the engine behind the conversation changes.
 * Purely a client-side toggle sent with each chat request (body.runtime).
 */
export const RuntimeToggle = ({ disabled }: { disabled?: boolean }) => {
  const [runtime, appStoreMutate] = appStore(
    useShallow((state) => [state.runtime, state.mutate]),
  );
  const isCode = runtime === "code";

  return (
    <Tooltip>
      <TooltipTrigger asChild disabled={disabled}>
        <Button
          variant={"ghost"}
          size={"sm"}
          className={cn(
            "rounded-full p-2! hover:bg-input!",
            isCode && "bg-input! text-primary",
          )}
          onClick={() =>
            appStoreMutate({ runtime: isCode ? "normal" : "code" })
          }
        >
          {isCode ? <Code2 /> : <MessageCircle />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="flex flex-col gap-0.5">
        <span className="font-medium">
          {isCode ? "Code 模式(OpenCode)" : "聊天模式"}
        </span>
        <span className="text-xs text-muted-foreground">
          {isCode
            ? "訊息直接送 OpenCode 引擎產碼;點一下切回聊天"
            : "一般聊天;點一下切成 OpenCode 寫程式"}
        </span>
      </TooltipContent>
    </Tooltip>
  );
};

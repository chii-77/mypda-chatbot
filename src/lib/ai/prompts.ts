import { MCPToolInfo, McpServerCustomizationsPrompt } from "app-types/mcp";

import { Agent } from "app-types/agent";
import { UserPreferences } from "app-types/user";
import { User } from "better-auth";
import { format } from "date-fns";
import { createMCPToolId } from "./mcp/mcp-tool-id";

export const CREATE_THREAD_TITLE_PROMPT = `
You are a chat title generation expert.

Critical rules:
- Generate a concise title based on the first user message
- Title must be under 80 characters (absolutely no more than 80 characters)
- Summarize only the core content clearly
- Do not use quotes, colons, or special characters
- Use the same language as the user's message`;

export const buildAgentGenerationPrompt = (toolNames: string[]) => {
  const toolsList = toolNames.map((name) => `- ${name}`).join("\n");

  return `
You are an elite AI agent architect. Your mission is to translate user requirements into robust, high-performance agent configurations. Follow these steps for every request:

1. Extract Core Intent: Carefully analyze the user's input to identify the fundamental purpose, key responsibilities, and success criteria for the agent. Consider both explicit and implicit needs.

2. Design Expert Persona: Define a compelling expert identity for the agent, ensuring deep domain knowledge and a confident, authoritative approach to decision-making.

3. Architect Comprehensive Instructions: Write a system prompt that:
- Clearly defines the agent's behavioral boundaries and operational parameters
- Specifies methodologies, best practices, and quality control steps for the task
- Anticipates edge cases and provides guidance for handling them
- Incorporates any user-specified requirements or preferences
- Defines output format expectations when relevant

4. Strategic Tool Selection: Select only tools crucially necessary for achieving the agent's mission effectively from available tools:
${toolsList}

5. Optimize for Performance: Include decision-making frameworks, self-verification steps, efficient workflow patterns, and clear escalation or fallback strategies.

6. Output Generation: Return a structured object with these fields:
- name: Concise, descriptive name reflecting the agent's primary function
- description: 1-2 sentences capturing the unique value and primary benefit to users  
- role: Precise domain-specific expertise area
- instructions: The comprehensive system prompt from steps 2-5
- tools: Array of selected tool names from step 4

CRITICAL: Generate all output content in the same language as the user's request. Be specific and comprehensive. Proactively seek clarification if requirements are ambiguous. Your output should enable the new agent to operate autonomously and reliably within its domain.`.trim();
};

export const buildUserSystemPrompt = (
  user?: User,
  userPreferences?: UserPreferences,
  agent?: Agent,
) => {
  const assistantName = agent?.name || userPreferences?.botName || "myPDA";
  const currentTime = format(new Date(), "EEEE, MMMM d, yyyy 'at' h:mm:ss a");

  let prompt = `You are ${assistantName}`;

  if (agent?.instructions?.role) {
    prompt += `. You are an expert in ${agent.instructions.role}`;
  }

  prompt += `. The current date and time is ${currentTime}.`;

  // Agent-specific instructions as primary core
  if (agent?.instructions?.systemPrompt) {
    prompt += `
  # Core Instructions
  <core_capabilities>
  ${agent.instructions.systemPrompt}
  </core_capabilities>`;
  }

  // User context section (first priority)
  const userInfo: string[] = [];
  if (user?.name) userInfo.push(`Name: ${user.name}`);
  if (user?.email) userInfo.push(`Email: ${user.email}`);
  if (userPreferences?.profession)
    userInfo.push(`Profession: ${userPreferences.profession}`);

  if (userInfo.length > 0) {
    prompt += `

<user_information>
${userInfo.join("\n")}
</user_information>`;
  }

  // General capabilities (secondary)
  prompt += `

<general_capabilities>
You can assist with:
- Analysis and problem-solving across various domains
- Using available tools and resources to complete tasks
- Adapting communication to user preferences and context
</general_capabilities>`;

  // Communication preferences
  const displayName = userPreferences?.displayName || user?.name;
  const hasStyleExample = userPreferences?.responseStyleExample;

  if (displayName || hasStyleExample) {
    prompt += `

<communication_preferences>`;

    if (displayName) {
      prompt += `
- Address the user as "${displayName}" when appropriate to personalize interactions`;
    }

    if (hasStyleExample) {
      prompt += `
- Match this communication style and tone:
"""
${userPreferences.responseStyleExample}
"""`;
    }

    prompt += `

- When using tools, briefly mention which tool you'll use with natural phrases
- Examples: "I'll search for that information", "Let me check the weather", "I'll run some calculations"
- Use \`mermaid\` code blocks for diagrams and charts when helpful
</communication_preferences>`;
  }

  return prompt.trim();
};

export const buildSpeechSystemPrompt = (
  user: User,
  userPreferences?: UserPreferences,
  agent?: Agent,
) => {
  const assistantName = agent?.name || userPreferences?.botName || "Assistant";
  const currentTime = format(new Date(), "EEEE, MMMM d, yyyy 'at' h:mm:ss a");

  let prompt = `You are ${assistantName}`;

  if (agent?.instructions?.role) {
    prompt += `. You are an expert in ${agent.instructions.role}`;
  }

  prompt += `. The current date and time is ${currentTime}.`;

  // Agent-specific instructions as primary core
  if (agent?.instructions?.systemPrompt) {
    prompt += `# Core Instructions
    <core_capabilities>
    ${agent.instructions.systemPrompt}
    </core_capabilities>`;
  }

  // User context section (first priority)
  const userInfo: string[] = [];
  if (user?.name) userInfo.push(`Name: ${user.name}`);
  if (user?.email) userInfo.push(`Email: ${user.email}`);
  if (userPreferences?.profession)
    userInfo.push(`Profession: ${userPreferences.profession}`);

  if (userInfo.length > 0) {
    prompt += `

<user_information>
${userInfo.join("\n")}
</user_information>`;
  }

  // Voice-specific capabilities
  prompt += `

<voice_capabilities>
You excel at conversational voice interactions by:
- Providing clear, natural spoken responses
- Using available tools to gather information and complete tasks
- Adapting communication to user preferences and context
</voice_capabilities>`;

  // Communication preferences
  const displayName = userPreferences?.displayName || user?.name;
  const hasStyleExample = userPreferences?.responseStyleExample;

  if (displayName || hasStyleExample) {
    prompt += `

<communication_preferences>`;

    if (displayName) {
      prompt += `
- Address the user as "${displayName}" when appropriate to personalize interactions`;
    }

    if (hasStyleExample) {
      prompt += `
- Match this communication style and tone:
"""
${userPreferences.responseStyleExample}
"""`;
    }

    prompt += `
</communication_preferences>`;
  }

  // Voice-specific guidelines
  prompt += `

<voice_interaction_guidelines>
- Speak in short, conversational sentences (one or two per reply)
- Use simple words; avoid jargon unless the user uses it first
- Never use lists, markdown, or code blocks—just speak naturally
- When using tools, briefly mention what you're doing: "Let me search for that" or "I'll check the weather"
- If a request is ambiguous, ask a brief clarifying question instead of guessing
</voice_interaction_guidelines>`;

  return prompt.trim();
};

/**
 * Server-declared instructions (the MCP protocol's `instructions`, returned by
 * each server at initialize). Distinct from the user-authored customization
 * prompt built by `buildMcpServerCustomizationsSystemPrompt`. Keyed by the
 * platform server name so it lines up with the tool names the model sees.
 */
export const buildMcpServerInstructionsSystemPrompt = (
  instructions: Record<string, string>,
) => {
  const entries = Object.entries(instructions).filter(([, v]) => v?.trim());
  if (!entries.length) return "";
  const body = entries
    .map(([name, text]) => `<${name}>\n${text.trim()}\n</${name}>`)
    .join("\n");
  return `### MCP Server Instructions
- The following guidance is provided by each connected MCP server to describe what it is for and how to use its tools.
${body}`;
};

/**
 * Teaches the model how to author MCP Artifacts: the `create_mcp_artifact` tool,
 * the `window.mcp` API available inside an artifact, and the menu of MCP servers
 * + tools an artifact can call.
 */
export const buildMcpArtifactSystemPrompt = (
  servers: { name: string; tools: { name: string; description?: string }[] }[],
) => {
  const menu = servers.length
    ? servers
        .map(
          (s) =>
            `<${s.name}>\n${(s.tools ?? [])
              .map(
                (t) =>
                  `- ${t.name}${t.description ? `: ${t.description}` : ""}`,
              )
              .join("\n")}\n</${s.name}>`,
        )
        .join("\n")
    : "(no MCP servers are currently connected)";
  return `### MCP Artifacts
You can build an interactive HTML artifact with the \`create_mcp_artifact\` tool. An artifact is a sandboxed, FRONTEND-ONLY web UI whose ONLY backend is MCP. Inside the artifact's HTML, use the injected global API — do NOT use fetch/XHR/WebSocket (they are blocked by CSP):
- \`await window.mcp.servers()\` -> [{id, name, tools:[{name, description}]}]
- \`await window.mcp.call(serverName, toolName, argsObject)\` -> the raw MCP tool result
- \`window.mcp.json(result)\` -> the tool's structured data (handles every result shape)
- \`window.mcp.text(result)\` -> the tool's text output as a string
ALWAYS read tool output via \`window.mcp.json(result)\` (for JSON tools) or \`window.mcp.text(result)\` (for text). Do NOT touch \`result.content[0].text\` directly and do NOT assume it is a JSON string. \`json()\` returns null if there is no JSON, so guard before accessing fields (e.g. \`const data = window.mcp.json(r); const files = (data && data.files) || [];\`). Wrap calls in try/catch and show errors in the UI.

DO NOT GUESS A TOOL'S OUTPUT SCHEMA. The tool descriptions below may not list exact field names. When you are not 100% sure of the field/shape a tool returns, make the artifact resilient: first render the raw \`JSON.stringify(window.mcp.json(result), null, 2)\` (or the relevant slice) so the actual field names are visible, then build the polished UI against those real fields. Iterate over arrays/objects generically rather than hard-coding field names you assumed. (Example gotcha: a diff/compare tool may use op values like "replace"/"insert"/"delete" with "a"/"b" fields, not "add"/"remove"/"equal" — inspect the real output, don't assume.)

Write a self-contained HTML body (you may include <style> and <script>; CDN libraries from https://cdnjs.cloudflare.com are allowed). Build buttons and interactivity, call MCP tools for data, and render the results. Pass the relevant server name(s) in \`allowedServers\`.

You also have a BUILT-IN, STATELESS AI tool under the reserved server name "ai" (no MCP server needed, always available):
- \`window.mcp.call("ai", "summarize", { instruction?, data })\` -> a concise summary of \`data\` (string or object)
- \`window.mcp.call("ai", "complete", { system?, prompt, image? })\` -> a free-form LLM completion; pass \`image\` (http(s) URL, data: URL, or raw base64) to ask about an image (vision)
Use it to summarize / rewrite / analyze results inside the artifact. It is stateless — pass everything it needs in the arguments. Read its output with \`window.mcp.text(result)\`. (No need to list "ai" in \`allowedServers\`.)
NOTE: the "ai" tool has NO "ocr". For OCR, use the \`ocr\` tool on the files MCP server (e.g. \`window.mcp.call("files-mcp", "ocr", { image_base64, instruction? })\`, or \`{ path }\` for a stored image). It returns an object {text, model, chars}; read the text with \`window.mcp.json(result).text\` (NOT window.mcp.text).

MCP servers and tools available to artifacts:
${menu}`;
};

export const buildMcpServerCustomizationsSystemPrompt = (
  instructions: Record<string, McpServerCustomizationsPrompt>,
) => {
  const prompt = Object.values(instructions).reduce((acc, v) => {
    if (!v.prompt && !Object.keys(v.tools ?? {}).length) return acc;
    acc += `
<${v.name}>
${v.prompt ? `- ${v.prompt}\n` : ""}
${
  v.tools
    ? Object.entries(v.tools)
        .map(
          ([toolName, toolPrompt]) =>
            `- **${createMCPToolId(v.name, toolName)}**: ${toolPrompt}`,
        )
        .join("\n")
    : ""
}
</${v.name}>
`.trim();
    return acc;
  }, "");
  if (prompt) {
    return `
### Tool Usage Guidelines
- When using tools, please follow the guidelines below unless the user provides specific instructions otherwise.
- These customizations help ensure tools are used effectively and appropriately for the current context.
${prompt}
`.trim();
  }
  return prompt;
};

export const generateExampleToolSchemaPrompt = (options: {
  toolInfo: MCPToolInfo;
  prompt?: string;
}) => `\n
You are given a tool with the following details:
- Tool Name: ${options.toolInfo.name}
- Tool Description: ${options.toolInfo.description}

${
  options.prompt ||
  `
Step 1: Create a realistic example question or scenario that a user might ask to use this tool.
Step 2: Based on that question, generate a valid JSON input object that matches the input schema of the tool.
`.trim()
}
`;

export const MANUAL_REJECT_RESPONSE_PROMPT = `\n
The user has declined to run the tool. Please respond with the following three approaches:

1. Ask 1-2 specific questions to clarify the user's goal.

2. Suggest the following three alternatives:
   - A method to solve the problem without using tools
   - A method utilizing a different type of tool
   - A method using the same tool but with different parameters or input values

3. Guide the user to choose their preferred direction with a friendly and clear tone.
`.trim();

export const buildToolCallUnsupportedModelSystemPrompt = `
### Tool Call Limitation
- You are using a model that does not support tool calls. 
- When users request tool usage, simply explain that the current model cannot use tools and that they can switch to a model that supports tool calling to use tools.
`.trim();

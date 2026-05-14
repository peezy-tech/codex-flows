#!/usr/bin/env node
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const HOST = process.env.OPENCODE_GO_PROXY_HOST || "127.0.0.1";
const PORT = Number(process.env.OPENCODE_GO_PROXY_PORT || "61973");
const API_KEY =
  process.env.OPENCODE_GO_API_KEY ||
  readEnvFile(`${process.env.HOME}/.env`).OPENCODE_GO_API_KEY;
const DUMP_DIR = process.env.OPENCODE_GO_PROXY_DUMP_DIR || "";
const UPSTREAM =
  process.env.OPENCODE_GO_UPSTREAM_URL ||
  "https://opencode.ai/zen/go/v1/chat/completions";

let requestSequence = 0;
const reasoningByCallId = new Map();
const toolNameMap = new Map();

if (!API_KEY) {
  console.error("OPENCODE_GO_API_KEY is not set and was not found in ~/.env");
  process.exit(1);
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method !== "POST" || request.url !== "/v1/responses") {
      sendJson(response, 404, {
        error: { message: "Only POST /v1/responses is supported." },
      });
      return;
    }

    const body = JSON.parse(await readBody(request));
    const toolMap = new Map();
    const chatBody = responsesToChatCompletions(body, toolMap);
    const dumpPrefix = dumpJson("request", {
      responses: body,
      chat: redactChatBody(chatBody),
    });

    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(chatBody),
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      sendJson(response, upstream.status, {
        error: {
          message: text.slice(0, 2000),
          type: "opencode_go_error",
        },
      });
      return;
    }

    const completion = await upstream.json();
    dumpJson("response", completion, dumpPrefix);
    sendResponsesSse(response, completion, body.model, toolMap);
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    if (response.headersSent) {
      response.end();
      return;
    }
    sendJson(response, 500, {
      error: {
        message: error instanceof Error ? error.message : String(error),
        type: "proxy_error",
      },
    });
  }
});

server.listen(PORT, HOST, () => {
  console.error(`opencode-go-responses-proxy listening on http://${HOST}:${PORT}/v1`);
});

function readEnvFile(path) {
  try {
    const entries = {};
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
      if (!match) continue;
      entries[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
    return entries;
  } catch {
    return {};
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let data = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      data += chunk;
    });
    request.on("end", () => resolve(data));
    request.on("error", reject);
  });
}

function responsesToChatCompletions(body, toolMap) {
  const messages = [];
  if (typeof body.instructions === "string" && body.instructions.trim()) {
    messages.push({ role: "system", content: body.instructions });
  }

  for (const message of inputToMessages(body.input)) {
    messages.push(message);
  }

  if (messages.length === 0) {
    messages.push({ role: "user", content: "" });
  }

  const chatBody = {
    model: body.model,
    messages,
    max_tokens: Math.max(Number(body.max_output_tokens ?? body.max_tokens ?? 1024), 1024),
    temperature: body.temperature,
    top_p: body.top_p,
    stream: false,
  };

  const tools = responsesToolsToChatTools(body.tools, toolMap);
  if (tools.length > 0) {
    chatBody.tools = tools;
    chatBody.tool_choice = body.tool_choice ?? "auto";
  }

  return stripUndefined(chatBody);
}

function inputToMessages(input) {
  if (typeof input === "string") {
    return [{ role: "user", content: input }];
  }
  if (!Array.isArray(input)) {
    return [];
  }

  const messages = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;

    if (item.type === "message") {
      const role = normalizeRole(item.role);
      const content = contentToText(item.content);
      if (content) messages.push({ role, content });
      continue;
    }

    if (item.type === "function_call") {
      const callId = item.call_id || item.id || `call_${cryptoRandomId()}`;
      messages.push(assistantToolCallMessage({
        callId,
        name: joinToolName(item.namespace, item.name),
        argumentsText: typeof item.arguments === "string"
          ? item.arguments
          : JSON.stringify(item.arguments ?? {}),
      }));
      continue;
    }

    if (item.type === "custom_tool_call") {
      const callId = item.call_id || item.id || `call_${cryptoRandomId()}`;
      messages.push(assistantToolCallMessage({
        callId,
        name: item.name,
        argumentsText: JSON.stringify({ input: item.input ?? "" }),
      }));
      continue;
    }

    if (item.type === "local_shell_call") {
      const callId = item.call_id || item.id || `call_${cryptoRandomId()}`;
      messages.push(assistantToolCallMessage({
        callId,
        name: "local_shell",
        argumentsText: JSON.stringify({ command: item.action?.command ?? [] }),
      }));
      continue;
    }

    if (item.type === "tool_search_call") {
      const callId = item.call_id || item.id || `call_${cryptoRandomId()}`;
      messages.push(assistantToolCallMessage({
        callId,
        name: "tool_search",
        argumentsText: JSON.stringify(item.arguments ?? {}),
      }));
      continue;
    }

    if (item.type === "function_call_output") {
      messages.push({
        role: "tool",
        tool_call_id: item.call_id || item.id || "tool_call",
        content: typeof item.output === "string"
          ? item.output
          : JSON.stringify(item.output ?? ""),
      });
      continue;
    }

    if (item.type === "custom_tool_call_output") {
      messages.push({
        role: "tool",
        tool_call_id: item.call_id || item.id || "tool_call",
        content: typeof item.output === "string"
          ? item.output
          : JSON.stringify(item.output ?? ""),
      });
      continue;
    }

    const content = contentToText(item.content ?? item.text ?? item);
    if (content) messages.push({ role: "user", content });
  }
  return messages;
}

function assistantToolCallMessage({ callId, name, argumentsText }) {
  return {
    role: "assistant",
    content: null,
    tool_calls: [{
      id: callId,
      type: "function",
      function: { name: safeHistoricalToolName(name), arguments: argumentsText },
    }],
    ...(reasoningByCallId.has(callId)
      ? { reasoning_content: reasoningByCallId.get(callId) }
      : {}),
  };
}

function safeHistoricalToolName(name) {
  const safe = String(name || "tool").replace(/[^A-Za-z0-9_-]/g, "_");
  return safe.slice(0, 64) || "tool";
}

function responsesToolsToChatTools(tools, toolMap) {
  if (!Array.isArray(tools)) return [];
  const result = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== "object") continue;

    if (tool.type === "function") {
      result.push(chatFunctionTool({
        namespace: null,
        name: tool.name,
        kind: "function_call",
        description: tool.description,
        parameters: tool.parameters ?? tool.input_schema,
        toolMap,
      }));
      continue;
    }

    if (tool.type === "custom" || tool.type === "freeform") {
      result.push(chatFunctionTool({
        namespace: null,
        name: tool.name,
        kind: "custom_tool_call",
        description: tool.description,
        parameters: {
          type: "object",
          properties: { input: { type: "string" } },
          required: ["input"],
        },
        toolMap,
      }));
      continue;
    }

    if (tool.type === "local_shell") {
      result.push(chatFunctionTool({
        namespace: null,
        name: tool.name ?? "local_shell",
        kind: "local_shell_call",
        description: tool.description,
        parameters: tool.parameters ?? tool.input_schema ?? {
          type: "object",
          properties: { command: { type: "array", items: { type: "string" } } },
          required: ["command"],
        },
        toolMap,
      }));
      continue;
    }

    if (tool.type === "tool_search") {
      result.push(chatFunctionTool({
        namespace: null,
        name: tool.name ?? "tool_search",
        kind: "tool_search_call",
        description: tool.description,
        parameters: tool.parameters ?? tool.input_schema ?? {
          type: "object",
          properties: {},
        },
        toolMap,
      }));
      continue;
    }

    if (tool.type === "namespace" && Array.isArray(tool.tools)) {
      for (const child of tool.tools) {
        if (!child || typeof child !== "object") continue;
        result.push(chatFunctionTool({
          namespace: tool.name,
          name: child.name,
          kind: child.type === "custom" || child.type === "freeform"
            ? "custom_tool_call"
            : "function_call",
          description: child.description,
          parameters: child.parameters ?? child.input_schema,
          toolMap,
        }));
      }
    }
  }
  return result;
}

function chatFunctionTool({ namespace, name, kind, description, parameters, toolMap }) {
  const safeName = safeToolName(namespace, name, toolMap);
  const originalName = joinToolName(namespace, name);
  toolMap.set(safeName, { namespace, name, kind });
  toolNameMap.set(safeName, { namespace, name, kind });
  return {
    type: "function",
    function: {
      name: safeName,
      description: [description, `Original Codex tool name: ${originalName}`]
        .filter(Boolean)
        .join("\n"),
      parameters: parameters ?? { type: "object", properties: {} },
    },
  };
}

function normalizeRole(role) {
  return role === "assistant" || role === "system" || role === "tool" ? role : "user";
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      return part.text ?? part.input_text ?? part.output_text ?? "";
    }).filter(Boolean).join("\n");
  }
  if (content && typeof content === "object") {
    return content.text ?? content.input_text ?? JSON.stringify(content);
  }
  return "";
}

function sendResponsesSse(response, completion, requestedModel, toolMap) {
  const responseId = `resp_${completion.id || cryptoRandomId()}`;
  const model = completion.model || requestedModel;
  const createdAt = completion.created || Math.floor(Date.now() / 1000);
  const message = completion.choices?.[0]?.message ?? {};
  const text = message.content || "";
  const reasoningContent = message.reasoning_content || "";
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const call of toolCalls) {
    if (call.id && reasoningContent) {
      reasoningByCallId.set(call.id, reasoningContent);
    }
  }
  const outputItems = responseOutputItems(text, toolCalls, toolMap);
  const usage = normalizeUsage(completion.usage);
  const responseObject = {
    id: responseId,
    object: "response",
    created_at: createdAt,
    status: "completed",
    model,
    output: [],
    usage,
  };

  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  writeEvent(response, "response.created", {
    type: "response.created",
    response: { ...responseObject, status: "in_progress" },
  });

  outputItems.forEach((item, outputIndex) => {
    if (item.type !== "message") {
      writeEvent(response, "response.output_item.done", {
        type: "response.output_item.done",
        response_id: responseId,
        output_index: outputIndex,
        item,
      });
      return;
    }

    writeEvent(response, "response.output_item.added", {
      type: "response.output_item.added",
      response_id: responseId,
      output_index: outputIndex,
      item: { ...item, content: [] },
    });
    writeEvent(response, "response.output_text.delta", {
      type: "response.output_text.delta",
      response_id: responseId,
      item_id: item.id,
      output_index: outputIndex,
      content_index: 0,
      delta: item.content[0]?.text ?? "",
    });
    writeEvent(response, "response.output_item.done", {
      type: "response.output_item.done",
      response_id: responseId,
      output_index: outputIndex,
      item,
    });
  });

  writeEvent(response, "response.completed", {
    type: "response.completed",
    response: { ...responseObject, output: outputItems },
  });
  response.write("data: [DONE]\n\n");
  response.end();
}

function responseOutputItems(text, toolCalls, toolMap) {
  const items = [];
  for (const call of toolCalls) {
    const functionName = call.function?.name || call.name || "unknown_tool";
    const mapped = toolMap.get(functionName) ?? toolNameMap.get(functionName);
    const split = mapped ?? splitToolName(functionName);
    const callId = call.id || `call_${cryptoRandomId()}`;
    const argumentsText = call.function?.arguments || "{}";
    if (split.kind === "custom_tool_call") {
      items.push({
        id: callId,
        type: "custom_tool_call",
        call_id: callId,
        name: split.name,
        input: customToolInput(argumentsText),
      });
      continue;
    }
    if (split.kind === "local_shell_call") {
      items.push({
        id: callId,
        type: "local_shell_call",
        call_id: callId,
        status: "completed",
        action: {
          type: "exec",
          command: localShellCommand(argumentsText),
        },
      });
      continue;
    }
    if (split.kind === "tool_search_call") {
      items.push({
        id: callId,
        type: "tool_search_call",
        call_id: callId,
        execution: "client",
        arguments: parseArgumentsObject(argumentsText),
      });
      continue;
    }
    items.push({
      id: callId,
      type: "function_call",
      call_id: callId,
      name: split.name,
      ...(split.namespace ? { namespace: split.namespace } : {}),
      arguments: argumentsText,
    });
  }
  if (text) {
    items.push({
      id: `msg_${cryptoRandomId()}`,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text, annotations: [] }],
    });
  }
  return items;
}

function splitToolName(name) {
  const separator = name.indexOf(".");
  if (separator === -1) return { name };
  return { namespace: name.slice(0, separator), name: name.slice(separator + 1) };
}

function joinToolName(namespace, name) {
  return namespace ? `${namespace}.${name}` : name;
}

function safeToolName(namespace, name, toolMap) {
  const base = joinToolName(namespace, name).replace(/[^A-Za-z0-9_-]/g, "_");
  if (base.length <= 64 && !toolMap.has(base)) return base;
  let index = toolMap.size + 1;
  let candidate = `tool_${index}`;
  while (toolMap.has(candidate)) {
    index += 1;
    candidate = `tool_${index}`;
  }
  return candidate;
}

function customToolInput(argumentsText) {
  try {
    const parsed = JSON.parse(argumentsText);
    if (typeof parsed === "string") return parsed;
    if (typeof parsed?.input === "string") return parsed.input;
    if (typeof parsed?.patch === "string") return parsed.patch;
    if (typeof parsed?.command === "string") return parsed.command;
    return JSON.stringify(parsed);
  } catch {
    return argumentsText;
  }
}

function localShellCommand(argumentsText) {
  try {
    const parsed = JSON.parse(argumentsText);
    if (Array.isArray(parsed?.command)) return parsed.command.map(String);
    if (typeof parsed?.command === "string") return ["bash", "-lc", parsed.command];
    if (Array.isArray(parsed?.cmd)) return parsed.cmd.map(String);
  } catch {}
  return ["bash", "-lc", argumentsText];
}

function parseArgumentsObject(argumentsText) {
  try {
    const parsed = JSON.parse(argumentsText);
    return parsed && typeof parsed === "object" ? parsed : { input: parsed };
  } catch {
    return { input: argumentsText };
  }
}

function writeEvent(response, event, data) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") {
    return { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  }

  const inputTokens = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0);
  const outputTokens = Number(usage.output_tokens ?? usage.completion_tokens ?? 0);
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: Number(usage.total_tokens ?? inputTokens + outputTokens),
    input_tokens_details: usage.input_tokens_details ?? usage.prompt_tokens_details ?? null,
    output_tokens_details: usage.output_tokens_details ?? usage.completion_tokens_details ?? null,
  };
}

function stripUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function dumpJson(kind, payload, prefix = null) {
  if (!DUMP_DIR) return prefix;
  mkdirSync(DUMP_DIR, { recursive: true });
  const id = prefix ?? `${String(++requestSequence).padStart(4, "0")}-${Date.now()}`;
  writeFileSync(`${DUMP_DIR}/${id}-${kind}.json`, JSON.stringify(payload, null, 2));
  return id;
}

function redactChatBody(chatBody) {
  return { ...chatBody };
}

function cryptoRandomId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

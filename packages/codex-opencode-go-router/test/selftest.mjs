#!/usr/bin/env node
import { createServer } from "node:http";
import { request as httpRequest } from "node:http";
import { spawn } from "node:child_process";

const adapterPath = new URL("../src/router.mjs", import.meta.url).pathname;
const fakeUpstreamPort = 61981;
const adapterPort = 61982;
const seenRequests = [];

const fakeUpstream = createServer(async (request, response) => {
  const body = JSON.parse(await readBody(request));
  seenRequests.push(body);
  const tool = body.tools?.[0]?.function;
  const content = body.messages?.map((message) => message.content).join("\n") ?? "";

  if (content.includes("reasoning-followup")) {
    const assistant = body.messages.find((message) => message.role === "assistant" && message.tool_calls);
    if (assistant?.reasoning_content !== "deepseek-thought") {
      sendJson(response, 400, {
        error: { message: "missing reasoning_content replay" },
      });
      return;
    }
    sendJson(response, 200, completion({ content: "reasoning-ok" }));
    return;
  }

  if (!tool) {
    sendJson(response, 200, completion({ content: "plain-ok" }));
    return;
  }

  const args = tool.name.includes("custom")
    ? JSON.stringify({ input: "custom-input" })
    : tool.name.includes("local")
      ? JSON.stringify({ command: ["echo", "local-ok"] })
      : JSON.stringify({ value: "ok" });

  sendJson(response, 200, completion({
    toolCalls: [{
      id: `call_${tool.name}`,
      type: "function",
      function: { name: tool.name, arguments: args },
    }],
    reasoningContent: "deepseek-thought",
  }));
});

fakeUpstream.listen(fakeUpstreamPort, "127.0.0.1", async () => {
  const adapter = spawn(process.execPath, [adapterPath], {
    env: {
      ...process.env,
      OPENCODE_GO_API_KEY: "test-key",
      OPENCODE_GO_PROXY_HOST: "127.0.0.1",
      OPENCODE_GO_PROXY_PORT: String(adapterPort),
      OPENCODE_GO_UPSTREAM_URL: `http://127.0.0.1:${fakeUpstreamPort}/chat/completions`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  adapter.stderr.on("data", (chunk) => process.stderr.write(chunk));

  try {
    await waitForHealth(adapterPort);
    await assertOutputItem("plain", {
      model: "deepseek-v4-pro",
      input: "plain",
    }, (item) => item.type === "message" && item.content?.[0]?.text === "plain-ok");

    await assertOutputItem("function", {
      model: "deepseek-v4-pro",
      input: "call function",
      tools: [{ type: "function", name: "exec_command", parameters: objectSchema() }],
    }, (item) => item.type === "function_call" && item.name === "exec_command");

    await assertOutputItem("namespace", {
      model: "deepseek-v4-pro",
      input: "call namespace",
      tools: [{
        type: "namespace",
        name: "mcp__server__",
        tools: [{ type: "function", name: "echo", parameters: objectSchema() }],
      }],
    }, (item) =>
      item.type === "function_call" &&
      item.namespace === "mcp__server__" &&
      item.name === "echo");

    await assertOutputItem("custom", {
      model: "deepseek-v4-pro",
      input: "call custom",
      tools: [{ type: "custom", name: "custom_patch" }],
    }, (item) =>
      item.type === "custom_tool_call" &&
      item.name === "custom_patch" &&
      item.input === "custom-input");

    await assertOutputItem("local_shell", {
      model: "deepseek-v4-pro",
      input: "call local",
      tools: [{ type: "local_shell", name: "local_shell" }],
    }, (item) =>
      item.type === "local_shell_call" &&
      item.action?.command?.join(" ") === "echo local-ok");

    await assertOutputItem("tool_search", {
      model: "deepseek-v4-pro",
      input: "call search",
      tools: [{ type: "tool_search", name: "tool_search" }],
    }, (item) =>
      item.type === "tool_search_call" &&
      item.arguments?.value === "ok");

    const first = await requestResponses({
      model: "deepseek-v4-pro",
      input: "reasoning first",
      tools: [{ type: "function", name: "exec_command", parameters: objectSchema() }],
    });
    const call = first.output[0];
    await requestResponses({
      model: "deepseek-v4-pro",
      input: [
        call,
        { type: "function_call_output", call_id: call.call_id, output: "done" },
        { type: "message", role: "user", content: [{ type: "input_text", text: "reasoning-followup" }] },
      ],
    });

    await requestResponses({
      model: "deepseek-v4-pro",
      input: [
        { type: "custom_tool_call", call_id: "call_custom_replay", name: "custom_patch", input: "patch" },
        { type: "custom_tool_call_output", call_id: "call_custom_replay", output: "patched" },
        { type: "local_shell_call", call_id: "call_local_replay", status: "completed", action: { type: "exec", command: ["pwd"] } },
        { type: "function_call_output", call_id: "call_local_replay", output: "cwd" },
        { type: "tool_search_call", call_id: "call_search_replay", execution: "client", arguments: { query: "x" } },
        { type: "function_call_output", call_id: "call_search_replay", output: "found" },
        { type: "message", role: "user", content: [{ type: "input_text", text: "plain after replay" }] },
      ],
    });

    console.log(JSON.stringify({
      ok: true,
      cases: [
        "plain",
        "function",
        "namespace",
        "custom",
        "local_shell",
        "tool_search",
        "reasoning_replay",
        "history_replay",
      ],
      upstreamRequests: seenRequests.length,
    }, null, 2));
  } finally {
    adapter.kill();
    fakeUpstream.close();
  }
});

function completion({ content = null, toolCalls = undefined, reasoningContent = undefined }) {
  return {
    id: "chatcmpl_test",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "deepseek-v4-pro",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content,
        ...(toolCalls ? { tool_calls: toolCalls } : {}),
        ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
      },
      finish_reason: toolCalls ? "tool_calls" : "stop",
    }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

function objectSchema() {
  return { type: "object", properties: {} };
}

async function assertOutputItem(label, body, predicate) {
  const response = await requestResponses(body);
  const item = response.output[0];
  if (!predicate(item)) {
    throw new Error(`${label} assertion failed: ${JSON.stringify(item)}`);
  }
}

async function requestResponses(body) {
  const payload = JSON.stringify(body);
  const { statusCode, text } = await new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: "127.0.0.1",
      port: adapterPort,
      path: "/v1/responses",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        text += chunk;
      });
      res.on("end", () => resolve({ statusCode: res.statusCode, text }));
    });
    req.on("error", reject);
    req.end(payload);
  });
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`adapter returned ${statusCode}: ${text}`);
  }
  return parseCompletedResponse(text);
}

function parseCompletedResponse(sse) {
  for (const chunk of sse.split("\n\n")) {
    if (!chunk.includes("event: response.completed")) continue;
    const data = chunk.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
    return JSON.parse(data).response;
  }
  throw new Error(`missing response.completed in ${sse}`);
}

async function waitForHealth(port) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("adapter did not become healthy");
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

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

import { DurableObject } from "cloudflare:workers";
import { Env, ChatMessage } from "./types";

const MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fast" as keyof AiModels;

const SYSTEM_PROMPT = `
You are a patient, calm, tech-savvy family tech helper.

The user is asking for help with phones, TVs, laptops, printers, Wi-Fi, streaming devices, smart home devices, and other home electronics.

Your tone should feel like a supportive son or daughter helping a parent or relative with technology.

Rules:
- Be warm, calm, and reassuring.
- Ask at most 1 or 2 clarifying questions when needed.
- Give steps from easiest and safest to more advanced.
- Avoid jargon unless needed, and explain it simply.
- Do not repeat steps the user already said they tried.
- Remember the device and troubleshooting steps already discussed.
- Be honest when you are unsure.
- Recommend professional repair when appropriate.
- Never give dangerous repair instructions.
- Keep replies practical, conversational, and easy to follow.
- Prefer short paragraphs and numbered steps when giving instructions.
`.trim();

export class ChatSession extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/reset" && request.method === "POST") {
      await this.ctx.storage.deleteAll();
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" }
      });
    }

    if (url.pathname !== "/chat" || request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }

    const body = (await request.json()) as { message?: string };
    const message = body.message?.trim();

    if (!message) {
      return new Response(JSON.stringify({ error: "Message is required" }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });
    }

    const history =
      ((await this.ctx.storage.get("history")) as ChatMessage[] | undefined) ?? [];

    const systemMessage: ChatMessage = {
      role: "system",
      content: SYSTEM_PROMPT
    };

    const userMessage: ChatMessage = {
      role: "user",
      content: message
    };

    const messages: ChatMessage[] = [
      systemMessage,
      ...history,
      userMessage
    ];

    try {
      const result = await this.env.AI.run(MODEL_ID, {
        messages,
        max_tokens: 400
      });

      const reply =
        (result as { response?: string })?.response?.trim() ||
        "Okay, let’s take this step by step. Tell me what device you’re working with and what it’s doing right now.";

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: reply
      };

      const newHistory: ChatMessage[] = [
        ...history,
        userMessage,
        assistantMessage
      ].slice(-12);

      await this.ctx.storage.put("history", newHistory);

      return new Response(JSON.stringify({ reply, history: newHistory }), {
        headers: { "content-type": "application/json" }
      });
    } catch (err) {
      console.error("AI.run failed:", err);
      return new Response(
        JSON.stringify({ error: "AI call failed", detail: String(err) }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }
  }
}
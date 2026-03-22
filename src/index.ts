import { Env } from "./types";
import { ChatSession } from "./session";

export { ChatSession };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Serve static assets
    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
      try {
        return await env.ASSETS.fetch(request);
      } catch (err) {
        console.error("ASSETS.fetch failed:", err);
        return new Response("Asset service error", { status: 500 });
      }
    }

    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const body = (await request.json()) as {
          sessionId?: string;
          message?: string;
        };

        const sessionId = body.sessionId || crypto.randomUUID();

        const id = env.CHAT_SESSION.idFromName(sessionId);
        const stub = env.CHAT_SESSION.get(id);

        try {
          return await stub.fetch("https://chat-session/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
          });
        } catch (err) {
          console.error("DO stub.fetch failed:", err);
          return new Response(
            JSON.stringify({ error: "DO fetch failed", detail: String(err) }),
            { status: 500, headers: { "content-type": "application/json" } }
          );
        }
      } catch (err) {
        console.error("/api/chat bad request:", err);
        return new Response(JSON.stringify({ error: "Invalid request" }), {
          status: 400,
          headers: { "content-type": "application/json" }
        });
      }
    }

    if (url.pathname === "/api/reset" && request.method === "POST") {
      try {
        const body = (await request.json()) as { sessionId?: string };
        if (!body.sessionId) {
          return new Response(JSON.stringify({ error: "sessionId is required" }), {
            status: 400,
            headers: { "content-type": "application/json" }
          });
        }

        const id = env.CHAT_SESSION.idFromName(body.sessionId);
        const stub = env.CHAT_SESSION.get(id);

        return await stub.fetch("https://chat-session/reset", {
          method: "POST"
        });
      } catch {
        return new Response(JSON.stringify({ error: "Invalid request" }), {
          status: 400,
          headers: {
            "content-type": "application/json"
          }
        });
      }
    }

    return new Response("Not found", { status: 404 });
  }
} satisfies ExportedHandler<Env>;
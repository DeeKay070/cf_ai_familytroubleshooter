import { Env } from "./types";
import { ChatSession } from "./session";

export { ChatSession };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const forwardToSession = async (
      path: string,
      init: RequestInit,
      bodyForKey?: { sessionId?: string; userId?: string }
    ): Promise<Response> => {
      const key = bodyForKey?.userId || bodyForKey?.sessionId || "default-session";
      const id = env.CHAT_SESSION.idFromName(key);
      const stub = env.CHAT_SESSION.get(id);
      return stub.fetch(`https://chat-session${path}`, init);
    };

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
          userId?: string;
          message?: string;
          selectedIssueId?: string;
          selectedDeviceName?: string;
        };
        const sessionId = body.sessionId || crypto.randomUUID();

        try {
          return await forwardToSession(
            "/chat",
            {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...body, sessionId })
            },
            { sessionId, userId: body.userId }
          );
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
        const body = (await request.json()) as { sessionId?: string; userId?: string };
        if (!body.sessionId) {
          return new Response(JSON.stringify({ error: "sessionId is required" }), {
            status: 400,
            headers: { "content-type": "application/json" }
          });
        }

        return await forwardToSession(
          "/reset",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
          },
          body
        );
      } catch {
        return new Response(JSON.stringify({ error: "Invalid request" }), {
          status: 400,
          headers: {
            "content-type": "application/json"
          }
        });
      }
    }

    if (url.pathname === "/api/tracker" && request.method === "GET") {
      const sessionId = url.searchParams.get("sessionId") || "default-session";
      const userId = url.searchParams.get("userId") || sessionId;
      try {
        return await forwardToSession(
          `/tracker?sessionId=${encodeURIComponent(sessionId)}&userId=${encodeURIComponent(userId)}`,
          {
            method: "GET"
          },
          { sessionId, userId }
        );
      } catch (err) {
        console.error("DO tracker fetch failed:", err);
        return new Response(
          JSON.stringify({ error: "DO fetch failed", detail: String(err) }),
          { status: 500, headers: { "content-type": "application/json" } }
        );
      }
    }

    if (url.pathname === "/api/issue" && request.method === "POST") {
      try {
        const body = (await request.json()) as {
          sessionId?: string;
          userId?: string;
          deviceName?: string;
          title?: string;
        };
        return await forwardToSession(
          "/issue",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
          },
          body
        );
      } catch {
        return new Response(JSON.stringify({ error: "Invalid request" }), {
          status: 400,
          headers: { "content-type": "application/json" }
        });
      }
    }

    if (url.pathname === "/api/step/status" && request.method === "POST") {
      try {
        const body = (await request.json()) as {
          sessionId?: string;
          userId?: string;
          issueId?: string;
          stepId?: string;
          status?: string;
        };
        return await forwardToSession(
          "/step/status",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
          },
          body
        );
      } catch {
        return new Response(JSON.stringify({ error: "Invalid request" }), {
          status: 400,
          headers: { "content-type": "application/json" }
        });
      }
    }

    if (url.pathname === "/api/step/save" && request.method === "POST") {
      try {
        const body = (await request.json()) as {
          sessionId?: string;
          userId?: string;
          issueId?: string;
          stepId?: string;
        };
        return await forwardToSession(
          "/step/save",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
          },
          body
        );
      } catch {
        return new Response(JSON.stringify({ error: "Invalid request" }), {
          status: 400,
          headers: { "content-type": "application/json" }
        });
      }
    }

    if (url.pathname === "/api/step/apply-saved" && request.method === "POST") {
      try {
        const body = (await request.json()) as {
          sessionId?: string;
          userId?: string;
          issueId?: string;
          savedStepId?: string;
        };
        return await forwardToSession(
          "/step/apply-saved",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
          },
          body
        );
      } catch {
        return new Response(JSON.stringify({ error: "Invalid request" }), {
          status: 400,
          headers: { "content-type": "application/json" }
        });
      }
    }

    return new Response("Not found", { status: 404 });
  }
} satisfies ExportedHandler<Env>;
export interface Env {
  AI: Ai;
  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
  CHAT_SESSION: DurableObjectNamespace;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
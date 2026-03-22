import { DurableObject } from "cloudflare:workers";
import {
  ChatMessage,
  DeviceRecord,
  Env,
  IssueRecord,
  IssueStep,
  SavedStep,
  SessionTracker,
  StepStatus,
  TrackerSnapshot
} from "./types";

const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as keyof AiModels;

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
- When giving troubleshooting guidance, include 2-4 concrete steps and use numbered lines.
`.trim();

const TRACKER_STORAGE_KEY = "tracker-state-v1";

const EMPTY_TRACKER: SessionTracker = {
  devices: [],
  issues: [],
  savedStepsByUser: {},
  historyBySession: {},
  activeIssueBySession: {}
};

const DEVICE_PATTERNS = [
  "iphone",
  "ipad",
  "macbook",
  "laptop",
  "desktop",
  "windows pc",
  "android phone",
  "pixel",
  "samsung phone",
  "tv",
  "samsung tv",
  "lg tv",
  "roku",
  "fire tv",
  "apple tv",
  "router",
  "modem",
  "printer",
  "playstation",
  "xbox"
];

function nowIso(): string {
  return new Date().toISOString();
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function buildIssueTitle(message: string): string {
  const text = message.trim().replace(/\s+/g, " ");
  return text.length > 90 ? `${text.slice(0, 87)}...` : text;
}

function tokenize(text: string): Set<string> {
  const stop = new Set([
    "the",
    "a",
    "an",
    "my",
    "is",
    "it",
    "and",
    "to",
    "on",
    "for",
    "of",
    "with",
    "in",
    "this",
    "that"
  ]);

  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((part) => part && part.length > 2 && !stop.has(part))
  );
}

function similarityScore(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (!ta.size || !tb.size) {
    return 0;
  }

  let overlap = 0;
  for (const token of ta) {
    if (tb.has(token)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(ta.size, tb.size);
}

function detectDeviceName(message: string): string | undefined {
  const lower = message.toLowerCase();

  for (const phrase of DEVICE_PATTERNS) {
    if (lower.includes(phrase)) {
      return phrase
        .split(" ")
        .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
        .join(" ");
    }
  }

  const match = message.match(
    /(?:my|the)\s+([a-z0-9\- ]{2,40}?)(?:\s+(?:won't|wont|doesn't|not|keeps|can't|cannot|is|has|won|fails|stuck))/i
  );

  if (!match) {
    return undefined;
  }

  return match[1]
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function extractStepsFromReply(reply: string): string[] {
  const lines = reply
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const extracted = lines
    .map((line) => line.replace(/^\d+[\).:-]?\s+/, ""))
    .map((line) => line.replace(/^[-*]\s+/, ""))
    .filter((line, index, arr) => {
      const normalized = normalize(line);
      return line.length >= 8 && arr.findIndex((item) => normalize(item) === normalized) === index;
    })
    .slice(0, 4);

  return extracted;
}

export class ChatSession extends DurableObject<Env> {
  private async getTracker(): Promise<SessionTracker> {
    const state = await this.ctx.storage.get<SessionTracker>(TRACKER_STORAGE_KEY);
    return state ?? { ...EMPTY_TRACKER };
  }

  private async saveTracker(tracker: SessionTracker): Promise<void> {
    await this.ctx.storage.put(TRACKER_STORAGE_KEY, tracker);
  }

  private getSnapshot(tracker: SessionTracker, sessionId: string, userId: string): TrackerSnapshot {
    const sessionIssues = tracker.issues.filter((issue) => issue.lastSessionId === sessionId);
    const deviceIds = new Set(sessionIssues.map((issue) => issue.deviceId));
    const devices = tracker.devices.filter((device) => deviceIds.has(device.id));

    return {
      devices,
      issues: sessionIssues,
      savedSteps: tracker.savedStepsByUser[userId] ?? [],
      activeIssueId: tracker.activeIssueBySession[sessionId]
    };
  }

  private resolveDevice(
    tracker: SessionTracker,
    inputDeviceName: string,
    timestamp: string
  ): DeviceRecord {
    const normalizedName = normalize(inputDeviceName);
    const existing = tracker.devices.find((device) => device.normalizedName === normalizedName);

    if (existing) {
      existing.updatedAt = timestamp;
      return existing;
    }

    const created: DeviceRecord = {
      id: crypto.randomUUID(),
      name: inputDeviceName,
      normalizedName,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    tracker.devices.push(created);
    return created;
  }

  private resolveIssue(
    tracker: SessionTracker,
    sessionId: string,
    device: DeviceRecord,
    message: string,
    selectedIssueId: string | undefined,
    timestamp: string
  ): IssueRecord {
    if (selectedIssueId) {
      const explicit = tracker.issues.find((issue) => issue.id === selectedIssueId);
      if (explicit) {
        explicit.updatedAt = timestamp;
        explicit.lastSessionId = sessionId;
        return explicit;
      }
    }

    const relatedIssues = tracker.issues.filter((issue) => issue.deviceId === device.id);
    const openIssues = relatedIssues.filter((issue) => issue.status === "open");

    let bestMatch: IssueRecord | undefined;
    let bestScore = 0;
    for (const issue of openIssues) {
      const score = similarityScore(issue.title, message);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = issue;
      }
    }

    if (bestMatch && bestScore >= 0.25) {
      bestMatch.updatedAt = timestamp;
      bestMatch.lastSessionId = sessionId;
      return bestMatch;
    }

    const activeIssueId = tracker.activeIssueBySession[sessionId];
    const activeIssue = activeIssueId
      ? tracker.issues.find((issue) => issue.id === activeIssueId && issue.status === "open")
      : undefined;
    if (activeIssue && activeIssue.deviceId === device.id) {
      activeIssue.updatedAt = timestamp;
      activeIssue.lastSessionId = sessionId;
      return activeIssue;
    }

    const created: IssueRecord = {
      id: crypto.randomUUID(),
      deviceId: device.id,
      title: buildIssueTitle(message),
      status: "open",
      createdAt: timestamp,
      updatedAt: timestamp,
      lastSessionId: sessionId,
      steps: []
    };

    tracker.issues.push(created);
    return created;
  }

  private addGeneratedSteps(issue: IssueRecord, reply: string, timestamp: string): void {
    const steps = extractStepsFromReply(reply);
    for (const text of steps) {
      const exists = issue.steps.some((step) => normalize(step.text) === normalize(text));
      if (!exists) {
        issue.steps.push({
          id: crypto.randomUUID(),
          text,
          status: "pending",
          createdAt: timestamp,
          updatedAt: timestamp,
          source: "ai"
        });
      }
    }
  }

  private buildContextForPrompt(issue: IssueRecord): string {
    const stepContext = issue.steps
      .map((step, index) => `${index + 1}. ${step.text} [${step.status}]`)
      .join("\n");

    return [
      `Issue title: ${issue.title}`,
      "Known troubleshooting steps and statuses:",
      stepContext || "(none yet)",
      "Do not repeat steps marked fixed or not_fixed unless user asks."
    ].join("\n");
  }

  private json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/tracker" && request.method === "GET") {
      const sessionId = url.searchParams.get("sessionId") ?? "default-session";
      const userId = url.searchParams.get("userId") ?? sessionId;
      const tracker = await this.getTracker();
      return this.json({ tracker: this.getSnapshot(tracker, sessionId, userId) });
    }

    if (url.pathname === "/step/status" && request.method === "POST") {
      let body: {
        sessionId?: string;
        userId?: string;
        issueId?: string;
        stepId?: string;
        status?: StepStatus;
      };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return this.json({ error: "Invalid request" }, 400);
      }

      if (!body.issueId || !body.stepId || !body.status) {
        return this.json({ error: "issueId, stepId and status are required" }, 400);
      }

      const sessionId = body.sessionId ?? "default-session";
      const userId = body.userId ?? sessionId;
      const tracker = await this.getTracker();
      const issue = tracker.issues.find((item) => item.id === body.issueId);
      if (!issue) {
        return this.json({ error: "Issue not found" }, 404);
      }

      const step = issue.steps.find((item) => item.id === body.stepId);
      if (!step) {
        return this.json({ error: "Step not found" }, 404);
      }

      const timestamp = nowIso();
      step.status = body.status;
      step.updatedAt = timestamp;
      issue.updatedAt = timestamp;
      if (body.status === "fixed") {
        issue.status = "resolved";
      }
      tracker.activeIssueBySession[sessionId] = issue.id;

      await this.saveTracker(tracker);
      return this.json({ ok: true, tracker: this.getSnapshot(tracker, sessionId, userId) });
    }

    if (url.pathname === "/step/save" && request.method === "POST") {
      let body: {
        sessionId?: string;
        userId?: string;
        issueId?: string;
        stepId?: string;
      };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return this.json({ error: "Invalid request" }, 400);
      }

      if (!body.issueId || !body.stepId) {
        return this.json({ error: "issueId and stepId are required" }, 400);
      }

      const sessionId = body.sessionId ?? "default-session";
      const userId = body.userId ?? sessionId;
      const tracker = await this.getTracker();

      const issue = tracker.issues.find((item) => item.id === body.issueId);
      const step = issue?.steps.find((item) => item.id === body.stepId);
      if (!issue || !step) {
        return this.json({ error: "Issue or step not found" }, 404);
      }

      const list = tracker.savedStepsByUser[userId] ?? [];
      const exists = list.some((saved) => normalize(saved.text) === normalize(step.text));
      if (!exists) {
        list.push({ id: crypto.randomUUID(), text: step.text, createdAt: nowIso() });
      }
      tracker.savedStepsByUser[userId] = list;

      const history = tracker.historyBySession[sessionId] ?? [];
      history.push({
        role: "assistant",
        content: "I saved that troubleshooting step for future use."
      });
      tracker.historyBySession[sessionId] = history;

      await this.saveTracker(tracker);
      return this.json({
        ok: true,
        confirmationMessage: "I saved that troubleshooting step for future use.",
        tracker: this.getSnapshot(tracker, sessionId, userId)
      });
    }

    if (url.pathname === "/step/apply-saved" && request.method === "POST") {
      let body: {
        sessionId?: string;
        userId?: string;
        issueId?: string;
        savedStepId?: string;
      };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return this.json({ error: "Invalid request" }, 400);
      }

      if (!body.issueId || !body.savedStepId) {
        return this.json({ error: "issueId and savedStepId are required" }, 400);
      }

      const sessionId = body.sessionId ?? "default-session";
      const userId = body.userId ?? sessionId;
      const tracker = await this.getTracker();
      const issue = tracker.issues.find((item) => item.id === body.issueId);
      if (!issue) {
        return this.json({ error: "Issue not found" }, 404);
      }

      const saved = (tracker.savedStepsByUser[userId] ?? []).find((step) => step.id === body.savedStepId);
      if (!saved) {
        return this.json({ error: "Saved step not found" }, 404);
      }

      const timestamp = nowIso();
      const exists = issue.steps.some((step) => normalize(step.text) === normalize(saved.text));
      if (!exists) {
        issue.steps.push({
          id: crypto.randomUUID(),
          text: saved.text,
          status: "pending",
          createdAt: timestamp,
          updatedAt: timestamp,
          source: "saved"
        });
        issue.updatedAt = timestamp;
      }

      await this.saveTracker(tracker);
      return this.json({ ok: true, tracker: this.getSnapshot(tracker, sessionId, userId) });
    }

    if (url.pathname === "/issue" && request.method === "POST") {
      let body: {
        sessionId?: string;
        userId?: string;
        deviceName?: string;
        title?: string;
      };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return this.json({ error: "Invalid request" }, 400);
      }

      if (!body.deviceName || !body.title) {
        return this.json({ error: "deviceName and title are required" }, 400);
      }

      const sessionId = body.sessionId ?? "default-session";
      const userId = body.userId ?? sessionId;
      const tracker = await this.getTracker();
      const timestamp = nowIso();
      const device = this.resolveDevice(tracker, body.deviceName.trim(), timestamp);
      const issue: IssueRecord = {
        id: crypto.randomUUID(),
        deviceId: device.id,
        title: body.title.trim(),
        status: "open",
        createdAt: timestamp,
        updatedAt: timestamp,
        lastSessionId: sessionId,
        steps: []
      };

      tracker.issues.push(issue);
      tracker.activeIssueBySession[sessionId] = issue.id;

      await this.saveTracker(tracker);
      return this.json({ ok: true, issue, tracker: this.getSnapshot(tracker, sessionId, userId) });
    }

    if (url.pathname === "/reset" && request.method === "POST") {
      let body: { sessionId?: string; userId?: string } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
      }

      const sessionId = body.sessionId ?? "default-session";
      const userId = body.userId ?? sessionId;
      const tracker = await this.getTracker();
      delete tracker.historyBySession[sessionId];
      delete tracker.activeIssueBySession[sessionId];

      await this.saveTracker(tracker);
      return this.json({ ok: true, tracker: this.getSnapshot(tracker, sessionId, userId) });
    }

    if (url.pathname !== "/chat" || request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }

    let body: {
      sessionId?: string;
      userId?: string;
      message?: string;
      selectedIssueId?: string;
      selectedDeviceName?: string;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return this.json({ error: "Invalid request" }, 400);
    }

    const sessionId = body.sessionId ?? "default-session";
    const userId = body.userId ?? sessionId;
    const message = body.message?.trim();

    if (!message) {
      return this.json({ error: "Message is required" }, 400);
    }

    const tracker = await this.getTracker();
    const timestamp = nowIso();
    const deviceName = body.selectedDeviceName?.trim() || detectDeviceName(message) || "Unknown Device";
    const device = this.resolveDevice(tracker, deviceName, timestamp);
    const issue = this.resolveIssue(
      tracker,
      sessionId,
      device,
      message,
      body.selectedIssueId,
      timestamp
    );
    tracker.activeIssueBySession[sessionId] = issue.id;

    const history = tracker.historyBySession[sessionId] ?? [];

    const systemMessage: ChatMessage = {
      role: "system",
      content: `${SYSTEM_PROMPT}\n\n${this.buildContextForPrompt(issue)}`
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
      ];

      tracker.historyBySession[sessionId] = newHistory;
      this.addGeneratedSteps(issue, reply, timestamp);
      issue.updatedAt = timestamp;
      device.updatedAt = timestamp;

      await this.saveTracker(tracker);

      return this.json({
        reply,
        history: newHistory,
        tracker: this.getSnapshot(tracker, sessionId, userId),
        activeIssueId: issue.id,
        activeDeviceId: device.id
      });
    } catch (err) {
      console.error("AI.run failed:", err);
      return this.json({ error: "AI call failed", detail: String(err) }, 500);
    }
  }
}
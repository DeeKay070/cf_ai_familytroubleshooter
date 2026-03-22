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

export type StepStatus = "pending" | "done" | "fixed" | "not_fixed" | "skipped";

export interface DeviceRecord {
  id: string;
  name: string;
  normalizedName: string;
  createdAt: string;
  updatedAt: string;
}

export interface IssueStep {
  id: string;
  text: string;
  status: StepStatus;
  createdAt: string;
  updatedAt: string;
  source: "ai" | "user" | "saved";
}

export interface IssueRecord {
  id: string;
  deviceId: string;
  title: string;
  status: "open" | "resolved";
  createdAt: string;
  updatedAt: string;
  lastSessionId: string;
  steps: IssueStep[];
}

export interface SavedStep {
  id: string;
  text: string;
  createdAt: string;
}

export interface SessionTracker {
  devices: DeviceRecord[];
  issues: IssueRecord[];
  savedStepsByUser: Record<string, SavedStep[]>;
  historyBySession: Record<string, ChatMessage[]>;
  activeIssueBySession: Record<string, string>;
}

export interface TrackerSnapshot {
  devices: DeviceRecord[];
  issues: IssueRecord[];
  savedSteps: SavedStep[];
  activeIssueId?: string;
}
const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const typingIndicator = document.getElementById("typing-indicator");
const newChatButton = document.getElementById("new-chat-button");
const createIssueButton = document.getElementById("create-issue-button");
const issueDeviceInput = document.getElementById("issue-device-input");
const issueTitleInput = document.getElementById("issue-title-input");
const trackerDevices = document.getElementById("tracker-devices");
const trackerSteps = document.getElementById("tracker-steps");
const savedStepsEl = document.getElementById("saved-steps");

let isProcessing = false;
let activeIssueId = null;
let trackerState = {
  devices: [],
  issues: [],
  savedSteps: [],
  activeIssueId: undefined
};

function getUserId() {
  let id = localStorage.getItem("family-tech-support-user");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("family-tech-support-user", id);
  }
  return id;
}

function getSessionId() {
  let id = localStorage.getItem("family-tech-support-session");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("family-tech-support-session", id);
  }
  return id;
}

function clearSessionId() {
  localStorage.removeItem("family-tech-support-session");
}

function getActiveIssue() {
  if (!activeIssueId) {
    return null;
  }
  return trackerState.issues.find((issue) => issue.id === activeIssueId) || null;
}

function getDevice(deviceId) {
  return trackerState.devices.find((device) => device.id === deviceId);
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatMessage(text) {
  return escapeHtml(text).replace(/\n/g, "<br>");
}

function addMessageToChat(role, content) {
  const messageEl = document.createElement("div");
  messageEl.className = `message ${role}-message`;
  messageEl.innerHTML = `<p>${formatMessage(content)}</p>`;
  chatMessages.appendChild(messageEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function resetChatUi() {
  chatMessages.innerHTML = "";
  addMessageToChat(
    "assistant",
    "Hey — tell me what device is giving you trouble, and what it’s doing."
  );
}

function applyTrackerFromResponse(payload) {
  if (!payload || !payload.tracker) {
    return;
  }
  trackerState = payload.tracker;
  activeIssueId = payload.activeIssueId || payload.tracker.activeIssueId || activeIssueId;
  renderTracker();
}

function issueStatusBadge(status) {
  return status === "resolved" ? "Resolved" : "Open";
}

function renderTracker() {
  renderDeviceIssues();
  renderIssueSteps();
  renderSavedSteps();
}

function renderDeviceIssues() {
  trackerDevices.innerHTML = "";

  if (!trackerState.devices.length) {
    trackerDevices.innerHTML = '<p class="empty-hint">No devices tracked yet.</p>';
    return;
  }

  for (const device of trackerState.devices) {
    const block = document.createElement("div");
    block.className = "device-block";

    const title = document.createElement("p");
    title.className = "device-title";
    title.textContent = device.name;
    block.appendChild(title);

    const issues = trackerState.issues.filter((issue) => issue.deviceId === device.id);
    if (!issues.length) {
      const empty = document.createElement("p");
      empty.className = "empty-hint";
      empty.textContent = "No issues yet.";
      block.appendChild(empty);
    }

    for (const issue of issues) {
      const button = document.createElement("button");
      button.className = `issue-chip ${issue.id === activeIssueId ? "active" : ""}`;
      button.innerHTML = `${escapeHtml(issue.title)}<span class="meta">${issueStatusBadge(issue.status)}</span>`;
      button.addEventListener("click", () => {
        activeIssueId = issue.id;
        renderTracker();
      });
      block.appendChild(button);
    }

    trackerDevices.appendChild(block);
  }
}

function stepStatusOptions(status) {
  const options = [
    ["pending", "Pending"],
    ["done", "Done"],
    ["fixed", "Fixed"],
    ["not_fixed", "Not Fixed"],
    ["skipped", "Skipped"]
  ];

  return options
    .map(([value, label]) => `<option value="${value}" ${status === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function renderIssueSteps() {
  trackerSteps.innerHTML = "";
  const issue = getActiveIssue();

  if (!issue) {
    trackerSteps.innerHTML = '<p class="empty-hint">Pick an issue to see exact fix steps.</p>';
    return;
  }

  if (!issue.steps.length) {
    trackerSteps.innerHTML = '<p class="empty-hint">No steps yet. Ask the assistant for troubleshooting guidance.</p>';
    return;
  }

  for (const step of issue.steps) {
    const card = document.createElement("div");
    card.className = "step-card";
    card.innerHTML = `
      <div class="step-top-row">
        <strong>${escapeHtml(step.text)}</strong>
      </div>
      <div class="step-controls">
        <select data-step-id="${step.id}">${stepStatusOptions(step.status)}</select>
        <button class="small-button secondary-button" data-save-step-id="${step.id}">Save step</button>
      </div>
    `;

    const select = card.querySelector("select");
    select.addEventListener("change", async (event) => {
      const nextStatus = event.target.value;
      await updateStepStatus(issue.id, step.id, nextStatus);
    });

    const saveButton = card.querySelector("button");
    saveButton.addEventListener("click", async () => {
      await saveStep(issue.id, step.id);
    });

    trackerSteps.appendChild(card);
  }
}

function renderSavedSteps() {
  savedStepsEl.innerHTML = "";
  if (!trackerState.savedSteps.length) {
    savedStepsEl.innerHTML = '<p class="empty-hint">No saved steps yet.</p>';
    return;
  }

  const issue = getActiveIssue();

  for (const step of trackerState.savedSteps) {
    const card = document.createElement("div");
    card.className = "saved-step-card";
    card.innerHTML = `
      <div class="saved-step-top-row">
        <span>${escapeHtml(step.text)}</span>
      </div>
    `;

    if (issue) {
      const button = document.createElement("button");
      button.className = "small-button secondary-button";
      button.textContent = "Apply to selected issue";
      button.addEventListener("click", async () => {
        await applySavedStep(issue.id, step.id);
      });
      card.appendChild(button);
    }

    savedStepsEl.appendChild(card);
  }
}

async function fetchTracker() {
  const params = new URLSearchParams({
    sessionId: getSessionId(),
    userId: getUserId()
  });

  try {
    const response = await fetch(`/api/tracker?${params.toString()}`);
    const data = await response.json();
    if (response.ok) {
      applyTrackerFromResponse(data);
    }
  } catch (_) {
  }
}

async function createIssue() {
  const deviceName = issueDeviceInput.value.trim();
  const title = issueTitleInput.value.trim();
  if (!deviceName || !title) {
    addMessageToChat("assistant", "Please add both a device and issue title.");
    return;
  }

  try {
    const response = await fetch("/api/issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: getSessionId(),
        userId: getUserId(),
        deviceName,
        title
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Could not create issue");
    }

    applyTrackerFromResponse(data);
    activeIssueId = data.issue?.id || activeIssueId;
    issueDeviceInput.value = "";
    issueTitleInput.value = "";
    renderTracker();
  } catch (_) {
    addMessageToChat("assistant", "I couldn’t create that issue right now. Please try again.");
  }
}

async function updateStepStatus(issueId, stepId, status) {
  try {
    const response = await fetch("/api/step/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: getSessionId(),
        userId: getUserId(),
        issueId,
        stepId,
        status
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Could not update step");
    }
    applyTrackerFromResponse(data);
  } catch (_) {
    addMessageToChat("assistant", "I couldn’t update that step status. Please try again.");
  }
}

async function saveStep(issueId, stepId) {
  try {
    const response = await fetch("/api/step/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: getSessionId(),
        userId: getUserId(),
        issueId,
        stepId
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Could not save step");
    }

    applyTrackerFromResponse(data);
    if (data.confirmationMessage) {
      addMessageToChat("assistant", data.confirmationMessage);
    }
  } catch (_) {
    addMessageToChat("assistant", "I couldn’t save that troubleshooting step right now.");
  }
}

async function applySavedStep(issueId, savedStepId) {
  try {
    const response = await fetch("/api/step/apply-saved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: getSessionId(),
        userId: getUserId(),
        issueId,
        savedStepId
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Could not apply saved step");
    }
    applyTrackerFromResponse(data);
  } catch (_) {
    addMessageToChat("assistant", "I couldn’t apply that saved step right now.");
  }
}

userInput.addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = `${this.scrollHeight}px`;
});

userInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendButton.addEventListener("click", sendMessage);
createIssueButton.addEventListener("click", createIssue);

newChatButton.addEventListener("click", async () => {
  const sessionId = localStorage.getItem("family-tech-support-session");
  const userId = getUserId();

  if (sessionId) {
    try {
      await fetch("/api/reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ sessionId, userId })
      });
    } catch (_) {
      // ignore reset errors
    }
  }

  clearSessionId();
  activeIssueId = null;
  trackerState = {
    devices: [],
    issues: [],
    savedSteps: trackerState.savedSteps,
    activeIssueId: undefined
  };
  resetChatUi();
  renderTracker();
  await fetchTracker();
  userInput.value = "";
  userInput.style.height = "auto";
  userInput.focus();
});

async function sendMessage() {
  const message = userInput.value.trim();
  if (!message || isProcessing) return;

  isProcessing = true;
  userInput.disabled = true;
  sendButton.disabled = true;
  typingIndicator.classList.add("visible");

  addMessageToChat("user", message);
  userInput.value = "";
  userInput.style.height = "auto";

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sessionId: getSessionId(),
        userId: getUserId(),
        message,
        selectedIssueId: activeIssueId,
        selectedDeviceName: getActiveIssue() ? getDevice(getActiveIssue().deviceId)?.name : undefined
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Request failed");
    }

    addMessageToChat("assistant", data.reply);
    applyTrackerFromResponse(data);
  } catch (error) {
    addMessageToChat(
      "assistant",
      "Sorry — something went wrong on my side. Please try again."
    );
  } finally {
    typingIndicator.classList.remove("visible");
    isProcessing = false;
    userInput.disabled = false;
    sendButton.disabled = false;
    userInput.focus();
  }
}

resetChatUi();
fetchTracker();
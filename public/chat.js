const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const typingIndicator = document.getElementById("typing-indicator");
const newChatButton = document.getElementById("new-chat-button");

let isProcessing = false;

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

newChatButton.addEventListener("click", async () => {
  const sessionId = localStorage.getItem("family-tech-support-session");

  if (sessionId) {
    try {
      await fetch("/api/reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ sessionId })
      });
    } catch (_) {
      // ignore reset errors
    }
  }

  clearSessionId();
  resetChatUi();
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
        message
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Request failed");
    }

    addMessageToChat("assistant", data.reply);
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
const chatBox = document.getElementById("chat-box");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const imageUpload = document.getElementById("image-upload");
const imagePreviewArea = document.getElementById("image-preview-area");
const imagePreview = document.getElementById("image-preview");
const clearImageButton = document.getElementById("clear-image-button");
const newChatButton = document.getElementById("new-chat-button");
const inputArea = document.querySelector(".input-area");

let chatHistory = []; // Array to store chat history [{role: 'user'/'model', parts: [...]}]
let selectedImageData = null; // To store { mime_type: '...', data: '...' (base64) }

// --- Dynamic Textarea Height ---
function adjustTextareaHeight() {
  userInput.style.height = "auto"; // Reset height to shrink if text is deleted
  // Set height based on scroll height, but ensure it respects min-height from CSS
  userInput.style.height =
    Math.max(
      userInput.scrollHeight,
      /* min-height value from CSS e.g., 20 */ 20
    ) + "px";
}

userInput.addEventListener("input", adjustTextareaHeight);

// Initial adjustment in case of pre-filled content (though unlikely here)
adjustTextareaHeight();
// --- End Dynamic Textarea Height ---

// --- Image Upload Handling ---
imageUpload.addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64String = e.target.result.split(",")[1]; // Get base64 part
      selectedImageData = {
        mime_type: file.type,
        data: base64String,
      };
      imagePreview.src = e.target.result; // Show preview
      imagePreviewArea.style.display = "block";
    };
    reader.readAsDataURL(file);
  }
  // Reset file input value so the 'change' event fires even if the same file is selected again
  event.target.value = null;
});

clearImageButton.addEventListener("click", () => {
  selectedImageData = null;
  imagePreview.src = "#";
  imagePreviewArea.style.display = "none";
  imageUpload.value = null; // Clear the file input
});
// --- End Image Upload Handling ---

// --- Session Control ---
function disableInputArea() {
  inputArea.style.display = "none"; // Hide the input area
  userInput.disabled = true; // Still disable for safety/state
  sendButton.disabled = true;
  imageUpload.disabled = true;
  // No need to style children if parent is hidden
  // clearImageButton.style.pointerEvents = "none";
  newChatButton.style.display = "block"; // Show New Chat button instead
}

function enableInputArea() {
  inputArea.style.display = "flex"; // Show the input area
  userInput.disabled = false;
  sendButton.disabled = false;
  imageUpload.disabled = false;
  // Explicitly re-enable the upload button label interaction
  document.querySelector(".upload-button").style.pointerEvents = "auto";
  document.querySelector(".upload-button").style.opacity = "1";
  clearImageButton.style.pointerEvents = "auto";
  newChatButton.style.display = "none"; // Hide New Chat button
}

newChatButton.addEventListener("click", () => {
  chatHistory = []; // Clear history
  chatBox.innerHTML = ""; // Clear display
  // Add the initial assistant message back
  addMessage("assistant", [
    { type: "text", content: "画像を生成したい内容を入力してください。" },
  ]);
  enableInputArea(); // Re-enable the input area
  // Clear image preview if any (important to do AFTER enabling area)
  selectedImageData = null;
  imagePreview.src = "#";
  imagePreviewArea.style.display = "none";
  imageUpload.value = null;
});

// --- Message Handling ---
function addMessage(sender, contentParts) {
  // contentParts is now an array [{type:'text', content:'...'}, {type:'image', content:'...'}]
  const messageDiv = document.createElement("div");
  messageDiv.classList.add("message", sender);

  const historyEntry = {
    role: sender === "user" ? "user" : "model",
    parts: [],
  };

  contentParts.forEach((part) => {
    if (part.type === "text") {
      const p = document.createElement("p");
      p.textContent = part.content;
      messageDiv.appendChild(p);
      historyEntry.parts.push({ text: part.content });
    } else if (part.type === "image") {
      // Create a container for the image and download button
      const imageContainer = document.createElement("div");
      imageContainer.classList.add("image-container");

      const img = document.createElement("img");
      img.src = part.content; // Can be data URL from upload or from API
      img.alt = sender === "user" ? "Uploaded Image" : "Generated Image";
      imageContainer.appendChild(img);

      // Add download button only for assistant-generated images
      if (sender === "assistant") {
        const downloadLink = document.createElement("a");
        downloadLink.href = part.content;
        // Suggest a filename (you might want to generate a more unique name)
        downloadLink.download = `generated_image_${Date.now()}.png`;
        downloadLink.classList.add("download-button");
        downloadLink.textContent = "⬇"; // Use an icon or text
        downloadLink.title = "画像をダウンロード"; // Tooltip
        imageContainer.appendChild(downloadLink);
      }
      // For user messages, just add the image (already limited by CSS)
      else if (sender === "user") {
        // Just append the img directly if no container needed, or container with only img
      }

      messageDiv.appendChild(imageContainer);

      // Add image to history only if it's from the model (generated)
      // Or if needed for multi-turn image editing later
      if (sender === "model") {
        // For history, we need the format expected by the backend helper create_content_part
        // It expects { inline_data: { mime_type: ..., data: base64_string } }
        // We only have the data URL here, need to parse it back if storing for history re-use
        // Let's skip adding model images to history for now to simplify
      } else if (sender === "user" && part.isUpload) {
        // User uploads are handled separately before sending, not added to history directly here
        // But we need to store the necessary info if we want to include uploads in history later
      }
    } else if (part.type === "thinking") {
      const p = document.createElement("p");
      p.textContent = "考え中";
      messageDiv.appendChild(p);
      messageDiv.classList.add("thinking");
      // Thinking indicators are not added to history
      return; // Don't add thinking message to history
    } else if (part.type === "error") {
      // Handle error display
      const p = document.createElement("p");
      p.textContent = part.content;
      messageDiv.appendChild(p);
      messageDiv.classList.add("error"); // Add error class
      // Errors are not added to history
      return;
    }
  });

  // Only add user and model messages to history
  if (sender === "user" || sender === "model") {
    // Basic history for text for now
    const historyParts = contentParts
      .filter((p) => p.type === "text")
      .map((p) => ({ text: p.content }));
    // If user message included an upload, we might want to represent it in history
    // For now, just storing text parts in history
    if (historyParts.length > 0) {
      chatHistory.push({
        role: sender === "user" ? "user" : "model",
        parts: historyParts,
      });
    }
  }

  chatBox.appendChild(messageDiv);
  chatBox.scrollTop = chatBox.scrollHeight;
  return messageDiv;
}

async function sendMessage() {
  const prompt = userInput.value.trim();
  if (!prompt && !selectedImageData) return; // Need prompt or image

  const userMessageParts = [];
  if (selectedImageData) {
    // Add uploaded image preview to chat
    userMessageParts.push({
      type: "image",
      content: imagePreview.src,
      isUpload: true,
    });
  }
  if (prompt) {
    userMessageParts.push({ type: "text", content: prompt });
  }

  addMessage("user", userMessageParts); // Display user message (text + preview)
  userInput.value = ""; // Clear input
  adjustTextareaHeight(); // Reset textarea height after clearing

  // Prepare data for API
  const requestData = {
    prompt: prompt, // Send original text prompt
    // Send history *excluding* the user message we just added
    history: chatHistory.slice(0, -1),
    image_data: selectedImageData, // Send selected image data { mime_type, data (base64) }
  };

  // Clear selected image *after* preparing data, before API call starts maybe? Or after success? Let's clear after sending.
  const currentSelectedImage = selectedImageData; // Keep a copy for the request
  selectedImageData = null; // Clear for next message
  imagePreview.src = "#";
  imagePreviewArea.style.display = "none";
  imageUpload.value = null;

  sendButton.disabled = true;
  userInput.disabled = true;
  imageUpload.disabled = true;
  document.querySelector(".upload-button").style.pointerEvents = "none";
  document.querySelector(".upload-button").style.opacity = "0.6";
  clearImageButton.style.pointerEvents = "none";

  const thinkingMessage = addMessage("assistant", [{ type: "thinking" }]);

  try {
    const response = await fetch("/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestData), // Send prompt, history, and optional image data
    });

    if (thinkingMessage && chatBox.contains(thinkingMessage)) {
      // Check if still exists
      chatBox.removeChild(thinkingMessage);
    }

    if (!response.ok) {
      const errorData = await response.json();
      // Display error message using addMessage
      addMessage("assistant", [
        {
          type: "error",
          content: `エラーが発生しました: ${
            errorData.error || `HTTP ${response.status}`
          }`,
        },
      ]);
      // Don't disable input on error, allow user to retry or start new
      enableInputArea(); // Re-enable input area on error
      newChatButton.style.display = "none"; // Keep new chat hidden on error
      return; // Stop processing on error
    }

    const data = await response.json();

    if (data.results && data.results.length > 0) {
      // Prepare parts for addMessage
      const assistantMessageParts = data.results.map((result) => ({
        type: result.type, // "text" or "image"
        content: result.content, // text content or base64 data URL
      }));
      addMessage("assistant", assistantMessageParts); // Add assistant message parts

      // Check if the response contains an image to trigger session end
      const hasImage = data.results.some((result) => result.type === "image");
      if (hasImage) {
        disableInputArea(); // Disable input and show "New Chat" button
      } else {
        // Re-enable input if no image was generated (allow follow-up text chat)
        enableInputArea();
        newChatButton.style.display = "none";
      }
    } else {
      addMessage("assistant", [
        { type: "text", content: "画像またはテキストが生成されませんでした。" },
      ]);
      // Re-enable input if nothing was generated
      enableInputArea();
      newChatButton.style.display = "none";
    }
  } catch (error) {
    console.error("Error sending message:", error);
    if (thinkingMessage && chatBox.contains(thinkingMessage)) {
      chatBox.removeChild(thinkingMessage);
    }
    // Display network or other JS errors
    addMessage("assistant", [
      { type: "error", content: `エラーが発生しました: ${error.message}` },
    ]);
    // Re-enable input on network/JS error
    enableInputArea();
    newChatButton.style.display = "none";
  } finally {
    // sendButton re-enabling is now handled by enableInputArea or stays disabled if session ends
    // userInput.focus(); // Focus handled by enableInputArea
  }
}

// --- Initial Setup ---
enableInputArea(); // Ensure input is enabled on load

// ... (event listeners for sendButton and userInput - no changes here) ...
sendButton.addEventListener("click", sendMessage);
userInput.addEventListener("keypress", (event) => {
  // Send on Ctrl+Enter, allow Enter for newline
  if (event.key === "Enter" && event.ctrlKey) {
    event.preventDefault(); // Prevent default newline insertion on Ctrl+Enter
    sendMessage();
  }
  // Removed the previous Enter (without Shift) check
});

// Initial height adjustment
adjustTextareaHeight();

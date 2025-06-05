// TTS Application JavaScript

class TTSApp {
  constructor() {
    this.currentAudioUrl = null;
    this.isGenerating = false;
    this.uploadedFile = null;
    this.extractedContent = "";

    // DOM elements initialization
    this.initializeDOMElements();
    this.attachEventListeners();

    // 初期化処理
    this.init();
  }

  initializeDOMElements() {
    // UI elements
    this.textInput = document.getElementById("text-input");
    this.charCount = document.getElementById("char-count");
    this.maxChars = document.getElementById("max-chars");
    this.generateButton = document.getElementById("generate-speech");
    this.audioPlayerSection = document.getElementById("audio-player-section");
    this.audioPlayer = document.getElementById("audio-player");
    this.processingStatus = document.getElementById("processing-status");

    // File upload elements
    this.uploadZone = document.getElementById("upload-zone");
    this.fileInput = document.getElementById("file-input");
    this.filePreview = document.getElementById("file-preview");
    this.fileName = document.getElementById("file-name");
    this.fileSize = document.getElementById("file-size");
    this.removeFileBtn = document.getElementById("remove-file");

    // Content area elements
    this.extractedContentDiv = document.getElementById("extracted-content");
    this.extractedContentDisplay = document.getElementById(
      "extracted-content-display"
    );

    // Mode switching elements
    this.textInputArea = document.getElementById("text-input-area");
    this.documentUploadArea = document.getElementById("document-upload-area");

    // Mode elements
    this.inputModeRadios = document.querySelectorAll(
      'input[name="input-mode"]'
    );
    this.textVoiceSettings = document.getElementById("text-voice-settings");

    // Speaker mode elements
    this.speakerModeRadios = document.querySelectorAll(
      'input[name="speaker-mode"]'
    );
    this.singleVoiceSettings = document.getElementById("single-voice-settings");
    this.multipleVoiceSettings = document.getElementById(
      "multiple-voice-settings"
    );

    // File upload elements (重複削除)
    this.uploadZone = document.getElementById("upload-zone");
    this.fileInput = document.getElementById("file-input");
    this.filePreview = document.getElementById("file-preview");
    this.fileName = document.getElementById("file-name");
    this.fileSize = document.getElementById("file-size");
    this.removeFileBtn = document.getElementById("remove-file");

    // Voice settings elements
    this.voiceSelect = document.getElementById("voice-select");
    this.voiceSelectA = document.getElementById("voice-select-a");
    this.voiceSelectB = document.getElementById("voice-select-b");
    this.voiceStyle = document.getElementById("voice-style");

    // Control elements
    this.generateBtn = document.getElementById("generate-speech");
    this.btnText = this.generateBtn.querySelector(".btn-text");
    this.btnLoading = this.generateBtn.querySelector(".btn-loading");

    // Audio elements
    this.audioPlayerSection = document.getElementById("audio-player-section");
    this.audioPlayer = document.getElementById("audio-player");

    // Status elements
    this.processingStatus = document.getElementById("processing-status");

    // 音声選択肢を充実させる
    this.populateVoiceOptions();
  }

  attachEventListeners() {
    // Input mode switching
    this.inputModeRadios.forEach((radio) => {
      radio.addEventListener("change", () => this.switchInputMode());
    });

    // Speaker mode switching
    this.speakerModeRadios.forEach((radio) => {
      radio.addEventListener("change", () => this.switchSpeakerMode());
    });

    // Text input
    this.textInput.addEventListener("input", () => this.updateCharacterCount());

    // File upload
    this.uploadZone.addEventListener("click", () => this.fileInput.click());
    this.uploadZone.addEventListener("dragover", (e) => this.handleDragOver(e));
    this.uploadZone.addEventListener("dragleave", (e) =>
      this.handleDragLeave(e)
    );
    this.uploadZone.addEventListener("drop", (e) => this.handleFileDrop(e));
    this.fileInput.addEventListener("change", (e) => this.handleFileSelect(e));
    this.removeFileBtn.addEventListener("click", () => this.removeFile());

    // Voice controls
    document
      .getElementById("preview-voice")
      ?.addEventListener("click", () => this.previewVoice());

    // Generate button
    this.generateBtn.addEventListener("click", () => this.generateSpeech());

    // Audio controls
    document
      .getElementById("download-wav")
      ?.addEventListener("click", () => this.downloadAudio("wav"));
    document
      .getElementById("download-mp3")
      ?.addEventListener("click", () => this.downloadAudio("mp3"));
    document
      .getElementById("generate-new")
      ?.addEventListener("click", () => this.resetForm());
  }

  switchInputMode() {
    const selectedMode = document.querySelector(
      'input[name="input-mode"]:checked'
    ).value;
    const textArea = document.getElementById("text-input-area");
    const documentArea = document.getElementById("document-upload-area");
    const textVoiceSettings = document.getElementById("text-voice-settings");
    const generateSection = document.querySelector(".generate-section");

    if (selectedMode === "text") {
      textArea.style.display = "block";
      documentArea.style.display = "none";
      textVoiceSettings.style.display = "block";
      generateSection.style.display = "block";
      this.hideExtractedContent();
      this.hideGeneratedAudio();
    } else {
      textArea.style.display = "none";
      documentArea.style.display = "block";
      textVoiceSettings.style.display = "none";
      generateSection.style.display = "none";
      this.resetFileUpload();
    }
  }

  switchSpeakerMode() {
    const selectedMode = document.querySelector(
      'input[name="speaker-mode"]:checked'
    ).value;

    if (selectedMode === "single") {
      this.singleVoiceSettings.style.display = "block";
      this.multipleVoiceSettings.style.display = "none";
    } else {
      this.singleVoiceSettings.style.display = "none";
      this.multipleVoiceSettings.style.display = "block";
    }
  }

  updateCharacterCount() {
    const currentLength = this.textInput.value.length;
    this.charCount.textContent = currentLength;

    // Update color based on usage
    const maxLength = parseInt(this.maxChars.textContent);
    const percentage = (currentLength / maxLength) * 100;

    if (percentage > 90) {
      this.charCount.style.color = "#f44336";
    } else if (percentage > 75) {
      this.charCount.style.color = "#ff9800";
    } else {
      this.charCount.style.color = "#666";
    }

    // 生成ボタンの状態も更新
    this.updateGenerateButton();
  }

  // File handling methods
  handleDragOver(e) {
    e.preventDefault();
    this.uploadZone.classList.add("dragover");
  }

  handleDragLeave(e) {
    e.preventDefault();
    this.uploadZone.classList.remove("dragover");
  }

  handleFileDrop(e) {
    e.preventDefault();
    this.uploadZone.classList.remove("dragover");

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      this.processFile(files[0]);
    }
  }

  handleFileSelect(e) {
    const files = e.target.files;
    if (files.length > 0) {
      this.processFile(files[0]);
    }
  }

  processFile(file) {
    // Validate file type
    const allowedTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "text/plain",
      "image/jpeg",
      "image/png",
    ];

    if (!allowedTypes.includes(file.type)) {
      this.showError("サポートされていないファイル形式です。");
      return;
    }

    // Check file size (50MB limit)
    if (file.size > 50 * 1024 * 1024) {
      this.showError(
        "ファイルサイズが大きすぎます。50MB以内のファイルを選択してください。"
      );
      return;
    }

    this.uploadedFile = file;
    this.showFilePreview(file);
    this.extractTextFromFile(file);
  }

  showFilePreview(file) {
    this.fileName.textContent = file.name;
    this.fileSize.textContent = this.formatFileSize(file.size);
    this.filePreview.style.display = "block";
  }

  formatFileSize(bytes) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  removeFile() {
    this.uploadedFile = null;
    this.extractedContent = "";
    this.filePreview.style.display = "none";
    this.extractedContentDiv.style.display = "none";
    this.fileInput.value = "";

    // 抽出コンテンツコントロールも削除
    const extractedControls = document.getElementById(
      "extracted-content-controls"
    );
    if (extractedControls) {
      extractedControls.remove();
    }
  }

  async extractTextFromFile(file) {
    try {
      this.showStatus("ファイルを処理中...");

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/tts/extract-text", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      if (result.success) {
        this.extractedContent = result.text;
        this.showExtractedContent(result.text);
      } else {
        throw new Error(result.error || "テキスト抽出に失敗しました。");
      }
    } catch (error) {
      console.error("Text extraction error:", error);
      this.showError(
        "ファイルからのテキスト抽出に失敗しました: " + error.message
      );
    } finally {
      this.hideStatus();
    }
  }

  showExtractedContent(text) {
    this.extractedContentDisplay.value = text;
    this.extractedContentDiv.style.display = "block";

    // 自動保存機能を追加
    this.extractedContentDisplay.addEventListener("input", () => {
      this.extractedContent = this.extractedContentDisplay.value;
    });

    // 抽出されたコンテンツ用の新しいコントロールを表示
    this.showExtractedContentControls();
  }

  showExtractedContentControls() {
    // 既存のコントロールがあれば削除
    const existingControls = document.getElementById(
      "extracted-content-controls"
    );
    if (existingControls) {
      existingControls.remove();
    }

    // 音声選択肢を特徴と共に定義
    const voiceOptions = {
      female: [
        { value: "Kore", label: "Kore - しっかりとした、自信に満ちた女性音声" },
        { value: "Aoede", label: "Aoede - 爽やかで自然な、風のような女性音声" },
        { value: "Leda", label: "Leda - 若々しくエネルギッシュな女性音声" },
        { value: "Zephyr", label: "Zephyr - 明るく陽気な女性音声" },
        { value: "Autonoe", label: "Autonoe - 明るく楽観的な女性音声" },
        {
          value: "Callirrhoe",
          label: "Callirrhoe - のんびりとリラックスした女性音声",
        },
        { value: "Despina", label: "Despina - なめらかで流暢な女性音声" },
        { value: "Erinome", label: "Erinome - クリアで正確な女性音声" },
        { value: "Gacrux", label: "Gacrux - 成熟した経験豊富な女性音声" },
        { value: "Laomedeia", label: "Laomedeia - 元気で活発な女性音声" },
        {
          value: "Pulcherrima",
          label: "Pulcherrima - 表現豊かで積極的な女性音声",
        },
        { value: "Sulafat", label: "Sulafat - 温かく歓迎的な女性音声" },
        { value: "Vindemiatrix", label: "Vindemiatrix - 優しく親切な女性音声" },
        { value: "Achernar", label: "Achernar - ソフトで優しい女性音声" },
      ],
      male: [
        { value: "Puck", label: "Puck - 明るくエネルギッシュな男性音声" },
        { value: "Charon", label: "Charon - 情報的でクリアな男性音声" },
        {
          value: "Fenrir",
          label: "Fenrir - 興奮しやすくダイナミックな男性音声",
        },
        { value: "Orus", label: "Orus - しっかりとした決断力のある男性音声" },
        {
          value: "Achird",
          label: "Achird - フレンドリーで親しみやすい男性音声",
        },
        { value: "Algenib", label: "Algenib - 重厚感のあるざらついた男性音声" },
        { value: "Algieba", label: "Algieba - なめらかで心地よい男性音声" },
        { value: "Alnilam", label: "Alnilam - しっかりとした力強い男性音声" },
        {
          value: "Enceladus",
          label: "Enceladus - 息づかいが感じられるソフトな男性音声",
        },
        { value: "Iapetus", label: "Iapetus - クリアで明瞭な男性音声" },
        {
          value: "Rasalgethi",
          label: "Rasalgethi - 情報的でプロフェッショナルな男性音声",
        },
        {
          value: "Sadachbia",
          label: "Sadachbia - 活気に満ちたアニメーションのような男性音声",
        },
        {
          value: "Sadaltager",
          label: "Sadaltager - 知識豊富で権威的な男性音声",
        },
        { value: "Schedar", label: "Schedar - 均等でバランスの取れた男性音声" },
        { value: "Umbriel", label: "Umbriel - のんびりと穏やかな男性音声" },
        {
          value: "Zubenelgenubi",
          label: "Zubenelgenubi - カジュアルで会話的な男性音声",
        },
      ],
    };

    // 音声選択のHTMLを生成
    const generateVoiceOptions = (voices) => {
      return voices
        .map(
          (voice) => `<option value="${voice.value}">${voice.label}</option>`
        )
        .join("");
    };

    // 新しいコントロールパネルを作成 - テキスト入力時と同じレイアウトに統一
    const controlsHtml = `
      <div id="extracted-content-controls" class="voice-settings">
        <h3>抽出されたコンテンツの処理</h3>
        
        <div class="settings-grid">
          <!-- 話者モード選択 -->
          <div class="setting-group">
            <label>話者モード</label>
            <div class="speaker-mode">
              <label class="speaker-option">
                <input type="radio" name="extracted-speaker-mode" value="single" checked>
                <span>単一話者</span>
              </label>
              <label class="speaker-option">
                <input type="radio" name="extracted-speaker-mode" value="multiple">
                <span>複数話者（最大2名）</span>
              </label>
            </div>
          </div>

          <!-- 単一話者設定 -->
          <div id="extracted-single-voice" class="voice-config">
            <div class="setting-group">
              <label for="extracted-voice-select">音声選択</label>
              <select id="extracted-voice-select">
                <optgroup label="女性音声">
                  ${generateVoiceOptions(voiceOptions.female)}
                </optgroup>
                <optgroup label="男性音声">
                  ${generateVoiceOptions(voiceOptions.male)}
                </optgroup>
              </select>
              <button id="preview-extracted-voice" class="btn btn-preview">
                プレビュー
              </button>
            </div>
          </div>

          <!-- 複数話者設定 -->
          <div id="extracted-multiple-voice" class="voice-config" style="display: none;">
            <div class="speaker-config">
              <h4>話者A</h4>
              <select id="extracted-voice-select-a">
                <optgroup label="女性音声">
                  ${generateVoiceOptions(voiceOptions.female)}
                </optgroup>
              </select>
              <button class="btn btn-preview" onclick="previewExtractedVoice('A')">
                プレビュー
              </button>
            </div>
            <div class="speaker-config">
              <h4>話者B</h4>
              <select id="extracted-voice-select-b">
                <optgroup label="男性音声">
                  ${generateVoiceOptions(voiceOptions.male)}
                </optgroup>
              </select>
              <button class="btn btn-preview" onclick="previewExtractedVoice('B')">
                プレビュー
              </button>
            </div>
          </div>

          <!-- 音声スタイル設定 -->
          <div class="setting-group">
            <label for="voice-style-extracted">音声スタイル</label>
            <input
              type="text"
              id="voice-style-extracted"
              placeholder="例: 明るく、ゆっくりと、丁寧に"
            />
            <small>自然言語で音声のスタイルを指定できます</small>
          </div>
        </div>

        <!-- アクションボタン -->
        <div class="action-buttons">
          <button type="button" class="btn btn-secondary" id="summarize-extracted-btn" style="margin-right: 12px;">
            <span class="btn-text">📝 要約を生成</span>
            <span class="btn-loading" style="display: none;">
              <div class="spinner"></div>
              要約中...
            </span>
          </button>
          <button type="button" class="btn btn-primary" id="generate-extracted-btn">
            <span class="btn-text">🔊 音声を生成</span>
            <span class="btn-loading" style="display: none;">
              <div class="spinner"></div>
              生成中...
            </span>
          </button>
        </div>
      </div>
    `;

    // 抽出コンテンツの後に挿入
    this.extractedContentDiv.insertAdjacentHTML("afterend", controlsHtml);

    // 話者モード切り替えのイベントリスナーを追加
    const speakerModeRadios = document.querySelectorAll(
      'input[name="extracted-speaker-mode"]'
    );
    speakerModeRadios.forEach((radio) => {
      radio.addEventListener("change", () => this.switchExtractedSpeakerMode());
    });

    // プレビューボタンのイベントリスナーを追加
    const previewBtn = document.getElementById("preview-extracted-voice");
    if (previewBtn) {
      previewBtn.addEventListener("click", () => this.previewExtractedVoice());
    }

    // 抽出コンテンツのボタンにイベントリスナーを追加
    const summarizeBtn = document.getElementById("summarize-extracted-btn");
    const generateBtn = document.getElementById("generate-extracted-btn");

    if (summarizeBtn) {
      summarizeBtn.addEventListener("click", () =>
        this.summarizeExtractedContent()
      );
    }

    if (generateBtn) {
      generateBtn.addEventListener("click", () => this.generateFromExtracted());
    }
  }

  switchExtractedSpeakerMode() {
    const speakerMode = document.querySelector(
      'input[name="extracted-speaker-mode"]:checked'
    ).value;
    const singleVoice = document.getElementById("extracted-single-voice");
    const multipleVoice = document.getElementById("extracted-multiple-voice");

    if (speakerMode === "single") {
      singleVoice.style.display = "block";
      multipleVoice.style.display = "none";
    } else {
      singleVoice.style.display = "none";
      multipleVoice.style.display = "block";
    }
  }

  async summarizeExtractedContent() {
    if (!this.extractedContent) {
      this.showError("要約するコンテンツがありません。");
      return;
    }

    // 現在選択されている話者モードを取得
    const speakerMode = document.querySelector(
      'input[name="extracted-speaker-mode"]:checked'
    ).value;

    // 進捗表示開始
    const summarizeBtn = document.getElementById("summarize-extracted-btn");
    this.startButtonLoading(summarizeBtn);

    try {
      const response = await fetch("/api/tts/summarize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: this.extractedContent,
          speaker_mode: speakerMode,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      if (result.success) {
        // 要約されたコンテンツで抽出内容を更新
        this.extractedContent = result.summary;

        // エディターの内容も更新
        this.extractedContentDisplay.value = result.summary;

        // 話者モードを保持（再生成を避ける）
        this.showSuccess(
          `${
            speakerMode === "single" ? "単一話者用" : "複数話者用"
          }要約が生成されました。`
        );
      } else {
        throw new Error(result.error || "要約生成に失敗しました。");
      }
    } catch (error) {
      console.error("Summarization error:", error);
      this.showError("要約生成に失敗しました: " + error.message);
    } finally {
      // 進捗表示終了
      this.stopButtonLoading(summarizeBtn);
    }
  }

  async generateFromExtracted() {
    if (!this.extractedContent.trim()) {
      this.showError("生成するコンテンツがありません。");
      return;
    }

    // 現在選択されている話者モードを取得
    const speakerMode = document.querySelector(
      'input[name="extracted-speaker-mode"]:checked'
    ).value;

    // 音声設定を取得
    let voiceSettings = {};
    if (speakerMode === "single") {
      const voiceSelect = document.getElementById("extracted-voice-select");
      voiceSettings = {
        voice: voiceSelect ? voiceSelect.value : "Kore",
      };
    } else {
      const voiceSelectA = document.getElementById("extracted-voice-select-a");
      const voiceSelectB = document.getElementById("extracted-voice-select-b");
      voiceSettings = {
        voiceA: voiceSelectA ? voiceSelectA.value : "Kore",
        voiceB: voiceSelectB ? voiceSelectB.value : "Puck",
      };
    }

    // 音声スタイルを取得
    const styleInput = document.getElementById("voice-style-extracted");
    const style = styleInput ? styleInput.value : "";

    // 進捗表示開始
    const generateBtn = document.getElementById("generate-extracted-btn");
    this.startButtonLoading(generateBtn);

    try {
      const response = await fetch("/api/tts/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: this.extractedContent,
          voice_settings: voiceSettings,
          speaker_mode: speakerMode,
          style: style,
          rate: 1.0,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      if (result.success) {
        // 音声プレイヤーを表示
        this.showAudioPlayer(result.audio_data, result.format);
        this.showSuccess(
          `${
            speakerMode === "single" ? "単一話者" : "複数話者"
          }音声が生成されました。`
        );
      } else {
        throw new Error(result.error || "音声生成に失敗しました。");
      }
    } catch (error) {
      console.error("Speech generation error:", error);
      this.showError("音声生成に失敗しました: " + error.message);
    } finally {
      // 進捗表示終了
      this.stopButtonLoading(generateBtn);
    }
  }

  getExtractedVoiceSettings(speakerMode) {
    if (speakerMode === "single") {
      return {
        voice:
          document.getElementById("extracted-voice-select")?.value || "Kore",
      };
    } else {
      return {
        voiceA:
          document.getElementById("extracted-voice-select-a")?.value || "Kore",
        voiceB:
          document.getElementById("extracted-voice-select-b")?.value || "Puck",
      };
    }
  }

  async previewVoice(speaker = null) {
    const voiceId = speaker
      ? speaker === "A"
        ? this.voiceSelectA.value
        : this.voiceSelectB.value
      : this.voiceSelect.value;

    try {
      const response = await fetch("/api/tts/preview-voice", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          voice: voiceId,
          text: "こんにちは。これは音声のプレビューです。",
          style: this.voiceStyle.value || "",
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      if (result.success) {
        // Base64デコードしてBlobを作成
        const binaryString = atob(result.audio_data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: `audio/${result.format}` });

        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);
        audio.play();

        // Clean up after playing
        audio.addEventListener("ended", () => {
          URL.revokeObjectURL(audioUrl);
        });
      } else {
        throw new Error(result.error || "音声プレビューに失敗しました");
      }
    } catch (error) {
      console.error("Voice preview error:", error);
      this.showError(error.message || "音声プレビューに失敗しました");
    }
  }

  // 抽出コンテンツ用のプレビュー機能を追加
  async previewExtractedVoice(speaker = null) {
    let voiceId;

    if (speaker) {
      const speakerMode = document.querySelector(
        'input[name="extracted-speaker-mode"]:checked'
      ).value;

      if (speakerMode === "multiple") {
        voiceId =
          speaker === "A"
            ? document.getElementById("extracted-voice-select-a")?.value ||
              "Kore"
            : document.getElementById("extracted-voice-select-b")?.value ||
              "Puck";
      } else {
        voiceId =
          document.getElementById("extracted-voice-select")?.value || "Kore";
      }
    } else {
      voiceId =
        document.getElementById("extracted-voice-select")?.value || "Kore";
    }

    try {
      const response = await fetch("/api/tts/preview-voice", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          voice: voiceId,
          text: "こんにちは。これは音声のプレビューです。",
          style: document.getElementById("voice-style-extracted")?.value || "",
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      if (result.success) {
        // Base64デコードしてBlobを作成
        const binaryString = atob(result.audio_data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: `audio/${result.format}` });

        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);
        audio.play();

        // Clean up after playing
        audio.addEventListener("ended", () => {
          URL.revokeObjectURL(audioUrl);
        });
      } else {
        throw new Error(result.error || "音声プレビューに失敗しました");
      }
    } catch (error) {
      console.error("Voice preview error:", error);
      this.showError(error.message || "音声プレビューに失敗しました");
    }
  }

  async generateSpeech() {
    if (this.isGenerating) return;

    // Get content to convert
    const inputMode = document.querySelector(
      'input[name="input-mode"]:checked'
    ).value;
    let textContent = "";

    if (inputMode === "text") {
      textContent = this.textInput.value.trim();
    } else {
      // 文書アップロードモードでは抽出コンテンツから取得
      textContent = this.extractedContentDisplay.value.trim();
    }

    if (!textContent) {
      this.showError("音声化するテキストを入力してください。");
      return;
    }

    // Get voice settings
    const speakerMode = document.querySelector(
      'input[name="speaker-mode"]:checked'
    ).value;
    const voiceSettings = this.getVoiceSettings(speakerMode);

    try {
      this.startGeneration();

      const response = await fetch("/api/tts/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: textContent,
          speaker_mode: speakerMode,
          voice_settings: voiceSettings,
          style: this.voiceStyle.value || "",
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      if (result.success) {
        // 音声プレイヤーを表示
        this.showAudioPlayer(result.audio_data, result.format);
        this.showSuccess("音声の生成が完了しました！");
      } else {
        throw new Error(result.error || "音声生成に失敗しました");
      }
    } catch (error) {
      console.error("Speech generation error:", error);
      this.showError(error.message || "音声生成に失敗しました");
    } finally {
      this.stopGeneration();
    }
  }

  getVoiceSettings(speakerMode) {
    if (speakerMode === "single") {
      return {
        voice: this.voiceSelect.value,
      };
    } else {
      return {
        voiceA: this.voiceSelectA.value,
        voiceB: this.voiceSelectB.value,
      };
    }
  }

  startGeneration() {
    this.isGenerating = true;
    this.generateBtn.disabled = true;
    this.btnText.style.display = "none";
    this.btnLoading.style.display = "flex";
    this.showProcessingStatus();
  }

  stopGeneration() {
    this.isGenerating = false;
    this.generateBtn.disabled = false;
    this.btnText.style.display = "inline";
    this.btnLoading.style.display = "none";
    this.hideProcessingStatus();
  }

  showAudioPlayer(audioData, format) {
    // Base64デコードしてBlobを作成
    const binaryString = atob(audioData);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: `audio/${format}` });

    // Clean up previous audio URL
    if (this.currentAudioUrl) {
      URL.revokeObjectURL(this.currentAudioUrl);
    }

    this.currentAudioUrl = URL.createObjectURL(blob);
    this.audioPlayer.src = this.currentAudioUrl;
    this.audioPlayerSection.style.display = "block";

    // Scroll to audio section
    this.audioPlayerSection.scrollIntoView({ behavior: "smooth" });
  }

  async downloadAudio(format) {
    if (!this.currentAudioUrl) {
      this.showError("ダウンロードする音声がありません。");
      return;
    }

    try {
      const response = await fetch(this.currentAudioUrl);
      const blob = await response.blob();

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `generated_speech.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Download error:", error);
      this.showError("ダウンロードに失敗しました: " + error.message);
    }
  }

  resetForm() {
    // Reset input
    this.textInput.value = "";
    this.updateCharacterCount();

    // Reset file upload
    this.removeFile();

    // Reset voice settings
    this.voiceStyle.value = "";

    // Hide audio player
    this.audioPlayerSection.style.display = "none";

    // Clean up audio URL
    if (this.currentAudioUrl) {
      URL.revokeObjectURL(this.currentAudioUrl);
      this.currentAudioUrl = null;
    }
  }

  // Status and notification methods
  showProcessingStatus() {
    this.processingStatus.style.display = "block";
    this.updateProcessingStep(1);

    // Simulate processing steps
    setTimeout(() => this.updateProcessingStep(2), 1000);
  }

  hideProcessingStatus() {
    this.updateProcessingStep(3);
    setTimeout(() => {
      this.processingStatus.style.display = "none";
      this.resetProcessingSteps();
    }, 1500);
  }

  updateProcessingStep(step) {
    const steps = this.processingStatus.querySelectorAll(".status-step");

    steps.forEach((stepEl, index) => {
      stepEl.classList.remove("active", "completed");

      if (index + 1 < step) {
        stepEl.classList.add("completed");
      } else if (index + 1 === step) {
        stepEl.classList.add("active");
      }
    });
  }

  resetProcessingSteps() {
    const steps = this.processingStatus.querySelectorAll(".status-step");
    steps.forEach((step) => {
      step.classList.remove("active", "completed");
    });
  }

  showStatus(message) {
    // You can implement a toast notification system here
    console.log("Status:", message);
  }

  hideStatus() {
    // Hide status notification
  }

  showError(message) {
    alert("エラー: " + message); // Replace with better notification system
  }

  showSuccess(message) {
    // You can implement a success notification system here
    console.log("Success:", message);
  }

  init() {
    this.updateCharacterCount();

    // 初期状態でテキスト入力モードを選択
    this.switchInputMode();

    // 音声生成ボタンを無効化（初期状態）
    this.updateGenerateButton();
  }

  updateGenerateButton() {
    // テキスト入力モード用の生成ボタンの状態を更新
    const inputMode = document.querySelector(
      'input[name="input-mode"]:checked'
    ).value;
    if (inputMode === "text") {
      const hasText = this.textInput.value.trim().length > 0;
      this.generateBtn.disabled = !hasText;
    }
  }

  showGeneratedAudio(audioUrl) {
    // showAudioPlayerメソッドに統合されたため、このメソッドは不要
    console.warn(
      "showGeneratedAudio is deprecated, use showAudioPlayer instead"
    );
  }

  hideGeneratedAudio() {
    this.audioPlayerSection.style.display = "none";
    if (this.currentAudioUrl) {
      URL.revokeObjectURL(this.currentAudioUrl);
      this.currentAudioUrl = null;
    }
  }

  hideExtractedContent() {
    this.extractedContentDiv.style.display = "none";
    // 抽出コンテンツコントロールも非表示
    const extractedControls = document.getElementById(
      "extracted-content-controls"
    );
    if (extractedControls) {
      extractedControls.style.display = "none";
    }
  }

  resetFileUpload() {
    this.uploadedFile = null;
    this.extractedContent = "";
    this.filePreview.style.display = "none";
    this.extractedContentDiv.style.display = "none";
    this.fileInput.value = "";

    // 抽出コンテンツコントロールも削除
    const extractedControls = document.getElementById(
      "extracted-content-controls"
    );
    if (extractedControls) {
      extractedControls.remove();
    }
  }

  startButtonLoading(button) {
    if (!button) return;

    const btnText = button.querySelector(".btn-text");
    const btnLoading = button.querySelector(".btn-loading");

    if (btnText && btnLoading) {
      button.disabled = true;
      btnText.style.display = "none";
      btnLoading.style.display = "flex";
    }
  }

  stopButtonLoading(button) {
    if (!button) return;

    const btnText = button.querySelector(".btn-text");
    const btnLoading = button.querySelector(".btn-loading");

    if (btnText && btnLoading) {
      button.disabled = false;
      btnText.style.display = "inline";
      btnLoading.style.display = "none";
    }
  }

  populateVoiceOptions() {
    // 音声選択肢を特徴と共に定義
    const voiceOptions = {
      female: [
        { value: "Kore", label: "Kore - しっかりとした、自信に満ちた女性音声" },
        { value: "Aoede", label: "Aoede - 爽やかで自然な、風のような女性音声" },
        { value: "Leda", label: "Leda - 若々しくエネルギッシュな女性音声" },
        { value: "Zephyr", label: "Zephyr - 明るく陽気な女性音声" },
        { value: "Autonoe", label: "Autonoe - 明るく楽観的な女性音声" },
        {
          value: "Callirrhoe",
          label: "Callirrhoe - のんびりとリラックスした女性音声",
        },
        { value: "Despina", label: "Despina - なめらかで流暢な女性音声" },
        { value: "Erinome", label: "Erinome - クリアで正確な女性音声" },
        { value: "Gacrux", label: "Gacrux - 成熟した経験豊富な女性音声" },
        { value: "Laomedeia", label: "Laomedeia - 元気で活発な女性音声" },
        {
          value: "Pulcherrima",
          label: "Pulcherrima - 表現豊かで積極的な女性音声",
        },
        { value: "Sulafat", label: "Sulafat - 温かく歓迎的な女性音声" },
        { value: "Vindemiatrix", label: "Vindemiatrix - 優しく親切な女性音声" },
        { value: "Achernar", label: "Achernar - ソフトで優しい女性音声" },
      ],
      male: [
        { value: "Puck", label: "Puck - 明るくエネルギッシュな男性音声" },
        { value: "Charon", label: "Charon - 情報的でクリアな男性音声" },
        {
          value: "Fenrir",
          label: "Fenrir - 興奮しやすくダイナミックな男性音声",
        },
        { value: "Orus", label: "Orus - しっかりとした決断力のある男性音声" },
        {
          value: "Achird",
          label: "Achird - フレンドリーで親しみやすい男性音声",
        },
        { value: "Algenib", label: "Algenib - 重厚感のあるざらついた男性音声" },
        { value: "Algieba", label: "Algieba - なめらかで心地よい男性音声" },
        { value: "Alnilam", label: "Alnilam - しっかりとした力強い男性音声" },
        {
          value: "Enceladus",
          label: "Enceladus - 息づかいが感じられるソフトな男性音声",
        },
        { value: "Iapetus", label: "Iapetus - クリアで明瞭な男性音声" },
        {
          value: "Rasalgethi",
          label: "Rasalgethi - 情報的でプロフェッショナルな男性音声",
        },
        {
          value: "Sadachbia",
          label: "Sadachbia - 活気に満ちたアニメーションのような男性音声",
        },
        {
          value: "Sadaltager",
          label: "Sadaltager - 知識豊富で権威的な男性音声",
        },
        { value: "Schedar", label: "Schedar - 均等でバランスの取れた男性音声" },
        { value: "Umbriel", label: "Umbriel - のんびりと穏やかな男性音声" },
        {
          value: "Zubenelgenubi",
          label: "Zubenelgenubi - カジュアルで会話的な男性音声",
        },
      ],
    };

    // 既存のオプションをクリア
    this.voiceSelect.innerHTML = "";

    // 女性音声のオプショングループを追加
    const femaleOptgroup = document.createElement("optgroup");
    femaleOptgroup.label = "女性音声";
    voiceOptions.female.forEach((voice) => {
      const option = document.createElement("option");
      option.value = voice.value;
      option.textContent = voice.label;
      femaleOptgroup.appendChild(option);
    });
    this.voiceSelect.appendChild(femaleOptgroup);

    // 男性音声のオプショングループを追加
    const maleOptgroup = document.createElement("optgroup");
    maleOptgroup.label = "男性音声";
    voiceOptions.male.forEach((voice) => {
      const option = document.createElement("option");
      option.value = voice.value;
      option.textContent = voice.label;
      maleOptgroup.appendChild(option);
    });
    this.voiceSelect.appendChild(maleOptgroup);

    // デフォルト選択
    this.voiceSelect.value = "Puck";
  }

  populateMultipleSpeakerVoices() {
    // 音声選択肢を特徴と共に定義
    const voiceOptions = {
      female: [
        { value: "Kore", label: "Kore - しっかりとした、自信に満ちた女性音声" },
        { value: "Aoede", label: "Aoede - 爽やかで自然な、風のような女性音声" },
        { value: "Leda", label: "Leda - 若々しくエネルギッシュな女性音声" },
        { value: "Zephyr", label: "Zephyr - 明るく陽気な女性音声" },
        { value: "Autonoe", label: "Autonoe - 明るく楽観的な女性音声" },
        {
          value: "Callirrhoe",
          label: "Callirrhoe - のんびりとリラックスした女性音声",
        },
        { value: "Despina", label: "Despina - なめらかで流暢な女性音声" },
        { value: "Erinome", label: "Erinome - クリアで正確な女性音声" },
        { value: "Gacrux", label: "Gacrux - 成熟した経験豊富な女性音声" },
        { value: "Laomedeia", label: "Laomedeia - 元気で活発な女性音声" },
        {
          value: "Pulcherrima",
          label: "Pulcherrima - 表現豊かで積極的な女性音声",
        },
        { value: "Sulafat", label: "Sulafat - 温かく歓迎的な女性音声" },
        { value: "Vindemiatrix", label: "Vindemiatrix - 優しく親切な女性音声" },
        { value: "Achernar", label: "Achernar - ソフトで優しい女性音声" },
      ],
      male: [
        { value: "Puck", label: "Puck - 明るくエネルギッシュな男性音声" },
        { value: "Charon", label: "Charon - 情報的でクリアな男性音声" },
        {
          value: "Fenrir",
          label: "Fenrir - 興奮しやすくダイナミックな男性音声",
        },
        { value: "Orus", label: "Orus - しっかりとした決断力のある男性音声" },
        {
          value: "Achird",
          label: "Achird - フレンドリーで親しみやすい男性音声",
        },
        { value: "Algenib", label: "Algenib - 重厚感のあるざらついた男性音声" },
        { value: "Algieba", label: "Algieba - なめらかで心地よい男性音声" },
        { value: "Alnilam", label: "Alnilam - しっかりとした力強い男性音声" },
        {
          value: "Enceladus",
          label: "Enceladus - 息づかいが感じられるソフトな男性音声",
        },
        { value: "Iapetus", label: "Iapetus - クリアで明瞭な男性音声" },
        {
          value: "Rasalgethi",
          label: "Rasalgethi - 情報的でプロフェッショナルな男性音声",
        },
        {
          value: "Sadachbia",
          label: "Sadachbia - 活気に満ちたアニメーションのような男性音声",
        },
        {
          value: "Sadaltager",
          label: "Sadaltager - 知識豊富で権威的な男性音声",
        },
        { value: "Schedar", label: "Schedar - 均等でバランスの取れた男性音声" },
        { value: "Umbriel", label: "Umbriel - のんびりと穏やかな男性音声" },
        {
          value: "Zubenelgenubi",
          label: "Zubenelgenubi - カジュアルで会話的な男性音声",
        },
      ],
    };

    // 話者A（女性音声）の設定
    const voiceSelectA = document.getElementById("voice-select-a");
    if (voiceSelectA) {
      voiceSelectA.innerHTML = "";
      const femaleOptgroup = document.createElement("optgroup");
      femaleOptgroup.label = "女性音声";
      voiceOptions.female.forEach((voice) => {
        const option = document.createElement("option");
        option.value = voice.value;
        option.textContent = voice.label;
        femaleOptgroup.appendChild(option);
      });
      voiceSelectA.appendChild(femaleOptgroup);
      voiceSelectA.value = "Kore"; // デフォルト
    }

    // 話者B（男性音声）の設定
    const voiceSelectB = document.getElementById("voice-select-b");
    if (voiceSelectB) {
      voiceSelectB.innerHTML = "";
      const maleOptgroup = document.createElement("optgroup");
      maleOptgroup.label = "男性音声";
      voiceOptions.male.forEach((voice) => {
        const option = document.createElement("option");
        option.value = voice.value;
        option.textContent = voice.label;
        maleOptgroup.appendChild(option);
      });
      voiceSelectB.appendChild(maleOptgroup);
      voiceSelectB.value = "Puck"; // デフォルト
    }
  }
}

// Global function for voice preview buttons in HTML
function previewVoice(speaker) {
  if (window.ttsApp) {
    window.ttsApp.previewVoice(speaker);
  }
}

// Global function for extracted content voice preview buttons
function previewExtractedVoice(speaker) {
  if (window.ttsApp) {
    window.ttsApp.previewExtractedVoice(speaker);
  }
}

// Initialize the application when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  window.ttsApp = new TTSApp();
});

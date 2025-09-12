import os
import io
from flask import Flask, request, jsonify, send_from_directory, make_response
from dotenv import load_dotenv
import google.generativeai as genai
from google import genai as genai_new
from google.genai import types as genai_types
import time
import pkg_resources # Import pkg_resources
# Remove direct type imports if they cause issues with the installed version
# from google.generativeai import types # Commented out or remove
from PIL import Image
import base64
import traceback # Keep for error logging

# Import TTS service
from tts_service import TTSService

load_dotenv()

app = Flask(__name__, static_folder='../frontend', static_url_path='')

# Initialize TTS service with error handling
tts_service = None
try:
    from tts_service import TTSService
    tts_service = TTSService()
    print("TTS service initialized successfully")
except Exception as e:
    print(f"Warning: TTS service initialization failed: {e}")
    print("TTS features will not be available, but image generation will still work")

# Print the installed version
try:
    version = pkg_resources.get_distribution("google-generativeai").version
    print(f"--- Using google-generativeai version: {version} ---")
except pkg_resources.DistributionNotFound:
    print("--- google-generativeai package not found ---")

# Configure the Gemini API client
api_key = os.getenv("GOOGLE_API_KEY")
if not api_key:
    raise ValueError("GOOGLE_API_KEY environment variable not set.")
genai.configure(api_key=api_key)

# Initialize new GenAI client (google.genai) for image/video generation
genai_client = genai_new.Client(api_key=api_key)

# Removed helper function create_content_part as we construct dictionaries directly

@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

# TTS Static Files
@app.route('/tts/')
def tts_index():
    return send_from_directory('../frontend/tts', 'index.html')

@app.route('/tts/<path:filename>')
def tts_static(filename):
    return send_from_directory('../frontend/tts', filename)

# Video Static Files
@app.route('/video/')
def video_index():
    return send_from_directory('../frontend/video', 'index.html')

@app.route('/video/<path:filename>')
def video_static(filename):
    return send_from_directory('../frontend/video', filename)

# TTS API Endpoints
@app.route('/api/tts/extract-text', methods=['POST'])
def extract_text():
    """文書からテキストを抽出"""
    if not tts_service:
        return jsonify({"success": False, "error": "TTS機能が利用できません。システム管理者にお問い合わせください。"}), 503
    
    try:
        if 'file' not in request.files:
            return jsonify({"success": False, "error": "ファイルが選択されていません"}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({"success": False, "error": "ファイルが選択されていません"}), 400
        
        # Read file content
        file_content = file.read()
        file_type = file.content_type
        filename = file.filename
        
        # Extract text using TTS service
        result = tts_service.extract_text_from_file(file_content, file_type, filename)
        
        return jsonify(result)
        
    except Exception as e:
        print(f"Text extraction endpoint error: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "error": f"テキスト抽出エラー: {str(e)}"}), 500

@app.route('/api/tts/summarize', methods=['POST'])
def summarize_text():
    """テキストを要約"""
    if not tts_service:
        return jsonify({"success": False, "error": "TTS機能が利用できません。システム管理者にお問い合わせください。"}), 503
        
    try:
        data = request.get_json()
        text = data.get('text')
        speaker_mode = data.get('speaker_mode', 'single')  # デフォルトは単一話者
        
        if not text:
            return jsonify({"success": False, "error": "要約するテキストが指定されていません"}), 400
        
        # Summarize using TTS service
        result = tts_service.summarize_text(text, speaker_mode)
        
        return jsonify(result)
        
    except Exception as e:
        print(f"Summarization endpoint error: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "error": f"要約エラー: {str(e)}"}), 500

@app.route('/api/tts/preview-voice', methods=['POST'])
def preview_voice():
    """音声プレビュー生成"""
    if not tts_service:
        return jsonify({"success": False, "error": "TTS service is not available"}), 503
    
    try:
        data = request.get_json()
        voice = data.get('voice', 'Kore')
        text = data.get('text', 'こんにちは。これは音声のプレビューです。')
        style = data.get('style', '')
        rate = data.get('rate', 1.0)
        
        result = tts_service.preview_voice(voice, text, style, rate)
        
        if result.get("success"):
            # JSON形式でレスポンスを返す
            return jsonify({
                "success": True,
                "audio_data": result["audio_data"],
                "format": result["format"]
            })
        else:
            return jsonify({"success": False, "error": result.get("error", "音声プレビューに失敗しました")}), 500
            
    except Exception as e:
        print(f"Preview voice error: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "error": f"音声プレビューエラー: {str(e)}"}), 500

@app.route('/api/tts/generate', methods=['POST'])
def generate_speech():
    """音声生成"""
    if not tts_service:
        return jsonify({"success": False, "error": "TTS service is not available"}), 503
    
    try:
        data = request.get_json()
        text = data.get('text', '')
        voice_settings = data.get('voice_settings', {})
        speaker_mode = data.get('speaker_mode', 'single')
        style = data.get('style', '')
        rate = data.get('rate', 1.0)
        
        if not text:
            return jsonify({"success": False, "error": "テキストが指定されていません"}), 400
        
        result = tts_service.generate_speech(text, voice_settings, speaker_mode, style, rate)
        
        if result.get("success"):
            # JSON形式でレスポンスを返す
            return jsonify({
                "success": True,
                "audio_data": result["audio_data"],
                "format": result["format"]
            })
        else:
            return jsonify({"success": False, "error": result.get("error", "音声生成に失敗しました")}), 500
            
    except Exception as e:
        print(f"Generate speech error: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "error": f"音声生成エラー: {str(e)}"}), 500

@app.route('/generate', methods=['POST'])
def generate_image():
    try:
        data = request.get_json()
        prompt = data.get('prompt')
        history_data = data.get('history', [])
        image_input_data = data.get('image_data') # { mime_type: ..., data: base64_string }
        images_input_data = data.get('images_data')  # [ { mime_type, data }, ... ]

        print(f"Received prompt: {prompt}")
        print(f"Received history length: {len(history_data)}")
        print(f"Received image data: {'Yes' if image_input_data else 'No'}")

        if not prompt and not image_input_data:
             return jsonify({"error": "Prompt or image is required"}), 400

        # --- Prompt Processing Step ---
        processed_prompt = None
        if prompt:
            try:
                print(f"--- Processing prompt: '{prompt}' ---")
                # Use a model good at instruction following
                prompt_processor_model = genai.GenerativeModel("gemini-2.0-flash") # Reverted to 1.5 flash for complex instructions

                # Determine instruction based on image presence
                if image_input_data:
                    # If image exists, just translate the text prompt for context
                    instruction = (
                        "Translate the following Japanese text to English, providing only the English translation. "
                        "This text accompanies an image."
                    )
                    log_prefix = "Translating accompanying prompt:"
                else:
                    # If no image, enhance the prompt for image generation
                    instruction = (
                        "You are a helpful assistant specializing in crafting effective prompts for AI image generation. "
                        "Take the user's request (provided in Japanese) and transform it into a detailed, descriptive English prompt "
                        "suitable for an AI image generator. Focus on visual details, style, composition, and desired mood. "
                        "IMPORTANT: If the generated image needs to contain any text, ensure that the text is ONLY in English. "
                        "Default Context: Unless the user specifies a location or ethnicity, depict Japanese settings or people. "
                        "Directly output ONLY the final enhanced English prompt, without any conversational text or explanations."
                    )
                    log_prefix = "Enhancing prompt for generation:"

                print(f"--- {log_prefix} '{prompt}' ---")
                enhancement_response = prompt_processor_model.generate_content(
                    f"{instruction}\n\nUser request (Japanese): {prompt}"
                )

                # Check if response has text and candidates (same logic as before)
                if (
                    enhancement_response.candidates
                    and enhancement_response.candidates[0].content
                    and enhancement_response.candidates[0].content.parts
                    and enhancement_response.candidates[0].content.parts[0].text
                ):
                    processed_prompt = enhancement_response.candidates[0].content.parts[0].text.strip()
                    print(f"--- Processed prompt: '{processed_prompt}' ---")
                else:
                    print(f"--- Prompt processing failed: No text part in response ---")
                    print(f"Processing response object: {enhancement_response}")
                    return jsonify({"error": "プロンプトの処理に失敗しました (応答が不正です)"}), 500

            except Exception as e:
                print(f"--- Prompt processing failed: Exception: {e} ---")
                traceback.print_exc()
                return jsonify({"error": f"プロンプトの処理中にエラーが発生しました: {e}"}), 500
        else:
            processed_prompt = None # Ensure variable exists even if there's no prompt
        # --- End Prompt Processing Step ---

        # Build contents using google.genai types
        contents_list = []

        # Map history into types.Content
        try:
            for h in history_data:
                role = h.get('role', 'user')
                parts = []
                for p in h.get('parts', []):
                    if 'text' in p and p['text']:
                        parts.append(genai_types.Part(text=p['text']))
                if parts:
                    contents_list.append(genai_types.Content(role=role, parts=parts))
        except Exception as e:
            print(f"History mapping skipped due to error: {e}")

        # Current user message
        current_parts = []
        if processed_prompt:
            current_parts.append(genai_types.Part(text=processed_prompt))

        # Normalize images list (support single image_data for backward compatibility)
        normalized_images = []
        if isinstance(images_input_data, list) and images_input_data:
            normalized_images = images_input_data
        elif image_input_data:
            normalized_images = [image_input_data]

        for idx, img in enumerate(normalized_images):
            try:
                mime_type = img.get('mime_type')
                b64_data = img.get('data')
                if not mime_type or not b64_data:
                    continue
                image_bytes = base64.b64decode(b64_data)
                blob = genai_types.Blob(mime_type=mime_type, data=image_bytes)
                current_parts.append(genai_types.Part(inline_data=blob))
                print(f"Added image[{idx}] part: {mime_type}, {len(image_bytes)} bytes")
            except Exception as e:
                print(f"Failed to process image[{idx}] for request: {e}")

        if not current_parts:
            print("Error: No valid parts to send after processing prompt and images.")
            return jsonify({"error": "送信する有効なメッセージパートがありません。"}), 400

        contents_list.append(genai_types.Content(role="user", parts=current_parts))

        # Call Gemini 2.5 Flash Image (Nano Banana)
        print(f"Sending contents to Gemini 2.5 Flash Image. parts_count={len(current_parts)}")
        response = genai_client.models.generate_content(
            model="gemini-2.5-flash-image-preview",
            contents=contents_list,
            config=genai_types.GenerateContentConfig(
                response_modalities=["TEXT", "IMAGE"]
            ),
        )

        # Parse response
        results = []
        if response and getattr(response, 'candidates', None):
            cand = response.candidates[0]
            if getattr(cand, 'content', None) and getattr(cand.content, 'parts', None):
                for part in cand.content.parts:
                    if getattr(part, 'text', None):
                        results.append({"type": "text", "content": part.text})
                    elif getattr(part, 'inline_data', None):
                        mime_type = getattr(part.inline_data, 'mime_type', 'image/png')
                        data_bytes = getattr(part.inline_data, 'data', b"")
                        base64_data = base64.b64encode(data_bytes).decode('utf-8')
                        data_url = f"data:{mime_type};base64,{base64_data}"
                        results.append({"type": "image", "content": data_url})

        if not results:
            return jsonify({"error": "モデルから有効な応答が得られませんでした。"}), 500

        return jsonify({"results": results})

    except genai.types.BlockedPromptException as e:
        print(f"BlockedPromptException: {e}")
        return jsonify({"error": f"リクエストがブロックされました。プロンプトの内容を確認してください。 {e}"}), 400
    except genai.types.StopCandidateException as e:
         print(f"StopCandidateException: {e}")
         return jsonify({"error": f"コンテンツ生成が安全上の理由で停止しました。 {e}"}), 400
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        traceback.print_exc()
        if "API key not valid" in str(e):
             return jsonify({"error": "無効なGoogle APIキーです。"}), 500
        # Check for the specific AttributeError again, if it persists with dicts
        if isinstance(e, AttributeError) and "'google.generativeai.types' has no attribute" in str(e):
             return jsonify({"error": f"SDKの互換性エラーが発生しました: {e}"}), 500

        return jsonify({"error": f"予期せぬエラーが発生しました: {str(e)}"}), 500


@app.route('/api/video/generate', methods=['POST'])
def generate_video():
    try:
        data = request.get_json()
        prompt = data.get('prompt', '')
        images_input_data = data.get('images_data', [])  # optional list
        options = data.get('options', {})  # duration, resolution, etc. (optional)

        # 画像アップロードを1枚のみに制限
        if isinstance(images_input_data, list) and len(images_input_data) > 1:
            return jsonify({"error": "動画生成では画像を1枚のみアップロードできます。複数枚の画像は選択できません。"}), 400  # duration, resolution, etc. (optional)

        # Prompt preprocessing: enhance/translate to rich English video prompt
        processed_prompt = prompt
        if prompt:
            try:
                prompt_processor_model = genai.GenerativeModel("gemini-2.0-flash")
                # If image is provided, enforce instruction to use it as first frame and preserve identity
                if images_input_data:
                    instruction = (
                        "You are a professional video prompt engineer. Rewrite the user's Japanese request "
                        "into a detailed, production-ready English prompt for Veo image-to-video generation. "
                        "IMPORTANT: The request includes a reference image. Instruct to USE THE ATTACHED IMAGE as the FIRST FRAME, "
                        "preserve subject identity, appearance, colors, and layout, then animate according to the instructions. "
                        "Be explicit about actions over time (timeline), camera movement (e.g., dolly-in, drone shot), composition/framing, "
                        "lighting and color mood, visual style, and ambience. Keep it concise but specific. Do not repeat numeric options. "
                        "Output only the final English prompt with no explanation."
                    )
                else:
                    instruction = (
                        "You are a professional video prompt engineer. Rewrite the user's Japanese request "
                        "into a detailed, production-ready English prompt for Veo video generation. "
                        "Be explicit about subject(s), actions over time (timeline), camera movement (e.g., dolly-in, drone shot), "
                        "composition and framing (e.g., close-up, wide shot), lighting and color mood, visual style (e.g., cinematic, anime), "
                        "and environment/ambience. Keep it concise but specific. If user gave duration/aspect/fps/style separately, do not repeat. "
                        "Output only the final English prompt with no explanation."
                    )
                enhancement_response = prompt_processor_model.generate_content(
                    f"{instruction}\n\nUser request (Japanese): {prompt}"
                )
                if (
                    enhancement_response.candidates
                    and enhancement_response.candidates[0].content
                    and enhancement_response.candidates[0].content.parts
                    and enhancement_response.candidates[0].content.parts[0].text
                ):
                    processed_prompt = enhancement_response.candidates[0].content.parts[0].text.strip()
            except Exception as e:
                print(f"Video prompt processing skipped: {e}")

        # Build prompt with options (no generation_config for video API)
        option_instructions = []
        duration = options.get('duration_seconds')
        # Clamp duration to 1-8 seconds (Veo 3 typical limit)
        try:
            if duration is not None:
                duration = max(1, min(8, int(duration)))
        except Exception:
            duration = None
        if duration:
            option_instructions.append(f"Duration: {duration} seconds.")
        aspect_ratio = options.get('aspect_ratio')
        if aspect_ratio:
            option_instructions.append(f"Aspect ratio: {aspect_ratio}.")
        fps = options.get('fps')
        if fps:
            option_instructions.append(f"Frame rate: {fps} fps.")
        style = options.get('style')
        if style:
            option_instructions.append(f"Style: {style}.")
        prompt_with_opts = processed_prompt or ''
        if option_instructions:
            prompt_with_opts = (processed_prompt or '') + "\n" + " ".join(option_instructions)

        # Enforce prompt requirement for video generation (text-to-video or image+text)
        if not (prompt_with_opts and len(prompt_with_opts.strip()) > 0):
            if images_input_data:
                return jsonify({"error": "画像から動画生成には指示テキストが必須です（画像モードのテキストを入力してください）。"}), 400
            else:
                return jsonify({"error": "テキストから動画生成にはプロンプトが必要です。"}), 400

        # Prepare optional single reference image (best-effort)
        image_arg = None
        if isinstance(images_input_data, list) and images_input_data:
            try:
                first = images_input_data[0]
                mime_type = first.get('mime_type')
                b64_data = first.get('data')
                if mime_type and b64_data:
                    # SDK v0.6.0以降では辞書形式が必要
                    image_arg = {
                        "imageBytes": b64_data,
                        "mimeType": mime_type.lower()  # 大文字小文字を正規化
                    }
                    print(f"Using first reference image for video: {mime_type}, base64_length={len(b64_data)}")
            except Exception as e:
                print(f"Failed to prepare reference image: {e}")

        # Call Veo 3 Fast via generate_videos (no response_modalities)
        # Build GenerateVideosConfig from options
        config_kwargs = {}
        if duration:
            config_kwargs["duration_seconds"] = int(duration)
        if aspect_ratio:
            # Allow only common ratios; ignore others silently
            allowed_ar = {"16:9", "9:16", "1:1", "4:3"}
            if aspect_ratio in allowed_ar:
                config_kwargs["aspect_ratio"] = aspect_ratio
        if fps:
            try:
                fps_int = int(fps)
                if fps_int in (24, 30, 60):
                    config_kwargs["frame_rate"] = fps_int
            except Exception:
                pass

        # Call Veo 3 Fast
        kwargs = {
            "model": "veo-3.0-fast-generate-001",
            "prompt": prompt_with_opts,
        }
        if config_kwargs:
            kwargs["config"] = genai_types.GenerateVideosConfig(**config_kwargs)
        if image_arg:
            kwargs["image"] = image_arg

        operation = genai_client.models.generate_videos(**kwargs)

        # Poll operation
        max_wait_sec = 120
        interval = 5
        waited = 0
        while not getattr(operation, 'done', False) and waited < max_wait_sec:
            time.sleep(interval)
            waited += interval
            operation = genai_client.operations.get(operation)

        if not getattr(operation, 'done', False):
            return jsonify({"error": "動画生成がタイムアウトしました。しばらくして再試行してください。"}), 504

        # Extract video file and download
        try:
            video_item = operation.response.generated_videos[0]
        except Exception as e:
            print(f"No generated_videos in response: {e}")
            return jsonify({"error": "モデルから動画出力が得られませんでした。"}), 500

        try:
            download_obj = genai_client.files.download(file=video_item.video)
            video_bytes = None
            # Try common attributes
            if isinstance(download_obj, (bytes, bytearray)):
                video_bytes = bytes(download_obj)
            elif hasattr(download_obj, 'data') and download_obj.data:
                video_bytes = download_obj.data
            elif hasattr(download_obj, 'contents') and download_obj.contents:
                video_bytes = download_obj.contents
            elif hasattr(download_obj, 'read'):
                video_bytes = download_obj.read()
            if not video_bytes:
                raise RuntimeError("Failed to obtain video bytes from download")

            mime_type = getattr(getattr(video_item, 'video', None), 'mime_type', 'video/mp4')
            base64_video = base64.b64encode(video_bytes).decode('utf-8')
            data_url = f"data:{mime_type};base64,{base64_video}"
            return jsonify({"results": [{"type": "video", "content": data_url}]})
        except Exception as e:
            print(f"Video download failed: {e}")
            traceback.print_exc()
            return jsonify({"error": f"動画のダウンロードに失敗しました: {str(e)}"}), 500
    except Exception as e:
        print(f"Video generation error: {e}")
        traceback.print_exc()
        
        # 429 RESOURCE_EXHAUSTED エラーの特別処理
        error_str = str(e)
        if "429" in error_str and ("RESOURCE_EXHAUSTED" in error_str or "quota" in error_str.lower()):
            return jsonify({
                "error": "動画生成の1日あたりの利用上限に達しました。明日再度お試しください。",
                "error_type": "quota_exceeded"
            }), 429
        elif "quota" in error_str.lower() or "exceeded" in error_str.lower():
            return jsonify({
                "error": "動画生成の利用上限に達しました。しばらく時間をおいてから再度お試しください。",
                "error_type": "quota_exceeded"
            }), 429
        
        return jsonify({"error": f"動画生成中にエラーが発生しました: {str(e)}"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True) 
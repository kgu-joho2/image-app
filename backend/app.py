import os
import io
from flask import Flask, request, jsonify, send_from_directory
from dotenv import load_dotenv
import google.generativeai as genai
import pkg_resources # Import pkg_resources
# Remove direct type imports if they cause issues with the installed version
# from google.generativeai import types # Commented out or remove
from PIL import Image
import base64
import traceback # Keep for error logging

load_dotenv()

app = Flask(__name__, static_folder='../frontend', static_url_path='')

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

# Removed helper function create_content_part as we construct dictionaries directly

@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/generate', methods=['POST'])
def generate_image():
    try:
        data = request.get_json()
        prompt = data.get('prompt')
        history_data = data.get('history', [])
        image_input_data = data.get('image_data') # { mime_type: ..., data: base64_string }

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

        # Construct the contents list using dictionaries directly
        contents = []

        # Process history (send original history)
        contents.extend(history_data)

        # Construct the current user message parts as dictionaries
        current_parts_list = []
        # Use the processed (enhanced or translated) prompt if available
        if processed_prompt:
            current_parts_list.append({"text": processed_prompt})

        if image_input_data:
            try:
                image_part_dict = {
                    "inline_data": {
                        "mime_type": image_input_data["mime_type"],
                        "data": image_input_data["data"]
                    }
                }
                current_parts_list.append(image_part_dict)
                print(f"Added uploaded image part: {image_input_data['mime_type']}")
            except (KeyError, TypeError) as e:
                print(f"Error processing uploaded image data structure: {e}")
                # Append error text or handle differently? Let's keep it simple.
                # Maybe don't add a text part here if image fails, rely on overall check.
                pass # Rely on the check below

        if not current_parts_list:
             # This case should ideally not happen if initial check passed,
             # but handles edge cases like failed image processing without text prompt.
            print("Error: No valid parts to send after processing prompt and image.")
            return jsonify({"error": "送信する有効なメッセージパートがありません。"}), 400

        contents.append({"role": "user", "parts": current_parts_list})

        # --- Call Image Generation Model (remains the same) ---
        model = genai.GenerativeModel("gemini-2.0-flash-exp-image-generation")

        # generation_config as dictionary (or None)
        generation_config_dict = {
             "response_modalities": ["TEXT", "IMAGE"], # Explicitly request image output
             # "temperature": 0.7 # Example
        }
        # if not generation_config_dict: # No longer needed as we always set modalities
        #      generation_config_dict = None

        print(f"Sending contents to Gemini (dict format): {contents}")
        print(f"Using generation_config: {generation_config_dict}") # Add log for config

        # Use generate_content with stream=True
        response_stream = model.generate_content(
            contents=contents,
            generation_config=generation_config_dict,
            stream=True # Set stream=True here
        )

        print("--- Processing Gemini API Stream ---")
        results = []
        full_response_text = "" # To accumulate text if needed

        try:
            for chunk in response_stream:
                if not chunk.candidates:
                    print("Received chunk with no candidates, skipping.")
                    continue

                print(f"Processing chunk: {chunk}") # Log each received chunk

                for part in chunk.candidates[0].content.parts:
                    print(f"Processing response part: {part}")
                    if hasattr(part, 'text') and part.text:
                        print(f"Found text part in chunk: {part.text[:50]}...")
                        results.append({"type": "text", "content": part.text})
                        full_response_text += part.text # Accumulate text if necessary

                    elif hasattr(part, 'inline_data') and part.inline_data:
                        print(f"Found inline_data part in chunk. Mime type: {part.inline_data.mime_type}")
                        image_data = part.inline_data.data
                        mime_type = part.inline_data.mime_type
                        base64_image = base64.b64encode(image_data).decode('utf-8')
                        data_url = f"data:{mime_type};base64,{base64_image}"
                        print(f"Generated data URL from chunk: {data_url[:100]}...")
                        results.append({"type": "image", "content": data_url})
                    else:
                        print(f"Chunk part has no processable text or inline_data: {part}")

        # Handle potential errors during streaming, like finish_reason being SAFETY
        except genai.types.BlockedPromptException as e:
             print(f"BlockedPromptException during stream: {e}")
             return jsonify({"error": f"リクエストがブロックされました。プロンプトの内容を確認してください。 {e}"}), 400
        except genai.types.StopCandidateException as e:
             print(f"StopCandidateException during stream: {e}")
             # Check if we got any results before stopping
             if results:
                  print("Stream stopped potentially due to safety, but sending partial results.")
                  # Optionally add a warning message to results
                  results.append({"type": "text", "content": "[注意: コンテンツ生成が途中で停止された可能性があります]"})
             else:
                  return jsonify({"error": f"コンテンツ生成が安全上の理由で停止しました。 {e}"}), 400
        # Catch other potential exceptions related to the stream
        except Exception as e:
            print(f"An error occurred during streaming: {e}")
            traceback.print_exc()
            return jsonify({"error": f"ストリーム処理中に予期せぬエラーが発生しました: {str(e)}"}), 500


        # Check prompt feedback after iterating through the stream if available on the stream object
        # (Note: prompt_feedback might be on the first chunk or aggregated differently in streaming)
        # Let's rely on the exceptions for now.

        print("--- Stream Processing Finished ---")
        print(f"Final accumulated results being sent to frontend: {results}")

        # If results are empty after processing stream (e.g., only empty chunks received)
        if not results:
             print("No processable content found in the entire stream.")
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

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True) 
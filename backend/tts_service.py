import os
import io
import base64
import tempfile
import traceback
import wave
from typing import Dict, Any, Optional, Union
from google import genai
from google.genai import types
from google.cloud import documentai
from google.cloud import vision
import PyPDF2
import docx
from pptx import Presentation
from PIL import Image
import speech_recognition as sr
import time

from gemini_client import generate_text, interactions_create

# https://ai.google.dev/gemini-api/docs/speech-generation
# turn_annotations: 2話者会話はセリフごとに speech_metadata.speaker の指定が必須（Interactions API で呼ぶ）
TTS_MODELS = {
    "flash-lite-3.8": {"id": "gemini-3.8-flash-lite-tts",    "label": "Gemini 3.8 Flash-Lite TTS (高速・低コスト)", "turn_annotations": True},
    "flash-3.8":      {"id": "gemini-3.8-flash-tts",         "label": "Gemini 3.8 Flash TTS (高品質)", "turn_annotations": True},
    "flash-3.1":      {"id": "gemini-3.1-flash-tts-preview", "label": "Gemini 3.1 Flash TTS (プレビュー)"},
}
DEFAULT_TTS_MODEL = "flash-lite-3.8"

# 30 音声 (name, 特徴, 傾向)
VOICES = [
    {"name": "Zephyr", "trait": "明るい", "gender": "female"},
    {"name": "Puck", "trait": "元気", "gender": "male"},
    {"name": "Charon", "trait": "説明調", "gender": "male"},
    {"name": "Kore", "trait": "しっかり", "gender": "female"},
    {"name": "Fenrir", "trait": "熱っぽい", "gender": "male"},
    {"name": "Leda", "trait": "若々しい", "gender": "female"},
    {"name": "Orus", "trait": "しっかり", "gender": "male"},
    {"name": "Aoede", "trait": "軽やか", "gender": "female"},
    {"name": "Callirrhoe", "trait": "おおらか", "gender": "female"},
    {"name": "Autonoe", "trait": "明るい", "gender": "female"},
    {"name": "Enceladus", "trait": "息づかい", "gender": "male"},
    {"name": "Iapetus", "trait": "クリア", "gender": "male"},
    {"name": "Umbriel", "trait": "おおらか", "gender": "male"},
    {"name": "Algieba", "trait": "なめらか", "gender": "male"},
    {"name": "Despina", "trait": "なめらか", "gender": "female"},
    {"name": "Erinome", "trait": "クリア", "gender": "female"},
    {"name": "Algenib", "trait": "しわがれ", "gender": "male"},
    {"name": "Rasalgethi", "trait": "説明調", "gender": "male"},
    {"name": "Laomedeia", "trait": "元気", "gender": "female"},
    {"name": "Achernar", "trait": "やわらか", "gender": "female"},
    {"name": "Alnilam", "trait": "しっかり", "gender": "male"},
    {"name": "Schedar", "trait": "落ち着き", "gender": "male"},
    {"name": "Gacrux", "trait": "成熟", "gender": "female"},
    {"name": "Pulcherrima", "trait": "はきはき", "gender": "female"},
    {"name": "Achird", "trait": "親しみやすい", "gender": "male"},
    {"name": "Zubenelgenubi", "trait": "カジュアル", "gender": "male"},
    {"name": "Vindemiatrix", "trait": "やさしい", "gender": "female"},
    {"name": "Sadachbia", "trait": "生き生き", "gender": "male"},
    {"name": "Sadaltager", "trait": "博識", "gender": "male"},
    {"name": "Sulafat", "trait": "あたたかい", "gender": "female"},
]

# テキスト中に挿入できるスタイルタグ
STYLE_TAGS = [
    {"tag": "[excitedly]", "label": "わくわく"},
    {"tag": "[whispers]", "label": "ささやき"},
    {"tag": "[shouting]", "label": "叫ぶ"},
    {"tag": "[laughs]", "label": "笑う"},
    {"tag": "[giggles]", "label": "くすくす"},
    {"tag": "[sarcastic]", "label": "皮肉っぽく"},
    {"tag": "[serious]", "label": "真剣に"},
    {"tag": "[tired]", "label": "疲れた声で"},
    {"tag": "[panicked]", "label": "慌てて"},
    {"tag": "[amazed]", "label": "驚いて"},
    {"tag": "[crying]", "label": "泣きながら"},
    {"tag": "[trembling]", "label": "震える声で"},
    {"tag": "[very slow]", "label": "とてもゆっくり"},
    {"tag": "[fast]", "label": "早口で"},
]

def wave_file(pcm_data, channels=1, rate=24000, sample_width=2):
    """
    PCMデータをWAVファイル形式に変換
    """
    wav_buffer = io.BytesIO()
    with wave.open(wav_buffer, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(sample_width)
        wf.setframerate(rate)
        wf.writeframes(pcm_data)
    wav_buffer.seek(0)
    return wav_buffer.getvalue()

class TTSService:
    def __init__(self):
        # Configure Gemini API
        api_key = os.getenv("GOOGLE_API_KEY")
        if not api_key:
            raise ValueError("GOOGLE_API_KEY environment variable not set.")
        
        # Initialize Gemini client
        self.client = genai.Client(api_key=api_key)
        
        # Initialize Document AI client if available
        self.document_ai_client = None
        try:
            if os.getenv("GOOGLE_APPLICATION_CREDENTIALS"):
                self.document_ai_client = documentai.DocumentProcessorServiceClient()
                self.project_id = os.getenv("GOOGLE_CLOUD_PROJECT_ID")
                self.processor_id = os.getenv("DOCUMENT_AI_PROCESSOR_ID")
                self.location = os.getenv("DOCUMENT_AI_LOCATION", "us")
        except Exception as e:
            print(f"Document AI initialization failed: {e}")
        
        # Initialize Vision API client if available
        self.vision_client = None
        try:
            if os.getenv("GOOGLE_APPLICATION_CREDENTIALS"):
                self.vision_client = vision.ImageAnnotatorClient()
        except Exception as e:
            print(f"Vision API initialization failed: {e}")

    def extract_text_from_file(self, file_content: bytes, file_type: str, filename: str) -> Dict[str, Any]:
        """
        ファイルからテキストを抽出します
        """
        try:
            if file_type == 'application/pdf':
                return self._extract_from_pdf(file_content)
            elif file_type == 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
                return self._extract_from_docx(file_content)
            elif file_type == 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
                return self._extract_from_pptx(file_content)
            elif file_type == 'text/plain':
                return self._extract_from_txt(file_content)
            elif file_type in ['image/jpeg', 'image/png']:
                return self._extract_from_image(file_content)
            else:
                raise ValueError(f"Unsupported file type: {file_type}")
                
        except Exception as e:
            print(f"Text extraction error: {e}")
            traceback.print_exc()
            return {
                "success": False,
                "error": f"テキスト抽出に失敗しました: {str(e)}"
            }

    def _extract_from_pdf(self, file_content: bytes) -> Dict[str, Any]:
        """PDFファイルからテキストを抽出"""
        try:
            # Document AI使用を優先
            if self.document_ai_client and self.project_id and self.processor_id:
                return self._extract_with_document_ai(file_content, "application/pdf")
            
            # フォールバック: PyPDF2を使用
            text = ""
            pdf_file = io.BytesIO(file_content)
            pdf_reader = PyPDF2.PdfReader(pdf_file)
            
            for page in pdf_reader.pages:
                text += page.extract_text() + "\n"
            
            return {
                "success": True,
                "text": text.strip(),
                "method": "PyPDF2"
            }
            
        except Exception as e:
            return {
                "success": False,
                "error": f"PDF処理エラー: {str(e)}"
            }

    def _extract_from_docx(self, file_content: bytes) -> Dict[str, Any]:
        """DOCXファイルからテキストを抽出"""
        try:
            doc_file = io.BytesIO(file_content)
            doc = docx.Document(doc_file)
            
            text = ""
            for paragraph in doc.paragraphs:
                text += paragraph.text + "\n"
            
            # テーブルからもテキストを抽出
            for table in doc.tables:
                for row in table.rows:
                    for cell in row.cells:
                        text += cell.text + " "
                    text += "\n"
            
            return {
                "success": True,
                "text": text.strip(),
                "method": "python-docx"
            }
            
        except Exception as e:
            return {
                "success": False,
                "error": f"DOCX処理エラー: {str(e)}"
            }

    def _extract_from_pptx(self, file_content: bytes) -> Dict[str, Any]:
        """PPTXファイルからテキストを抽出"""
        try:
            ppt_file = io.BytesIO(file_content)
            presentation = Presentation(ppt_file)
            
            text = ""
            for slide in presentation.slides:
                for shape in slide.shapes:
                    if hasattr(shape, "text"):
                        text += shape.text + "\n"
            
            return {
                "success": True,
                "text": text.strip(),
                "method": "python-pptx"
            }
            
        except Exception as e:
            return {
                "success": False,
                "error": f"PPTX処理エラー: {str(e)}"
            }

    def _extract_from_txt(self, file_content: bytes) -> Dict[str, Any]:
        """TXTファイルからテキストを抽出"""
        try:
            # UTF-8でデコードを試行
            try:
                text = file_content.decode('utf-8')
            except UnicodeDecodeError:
                # フォールバック: CP932やShift_JISを試行
                try:
                    text = file_content.decode('cp932')
                except UnicodeDecodeError:
                    text = file_content.decode('shift_jis')
            
            return {
                "success": True,
                "text": text.strip(),
                "method": "text-decode"
            }
            
        except Exception as e:
            return {
                "success": False,
                "error": f"TXT処理エラー: {str(e)}"
            }

    def _extract_from_image(self, file_content: bytes) -> Dict[str, Any]:
        """画像ファイルからOCRでテキストを抽出"""
        try:
            # Vision API使用を優先
            if self.vision_client:
                return self._extract_with_vision_api(file_content)
            
            # フォールバック（基本OCRライブラリがあれば）
            return {
                "success": False,
                "error": "OCR機能が利用できません。Google Cloud Vision APIの設定が必要です。"
            }
            
        except Exception as e:
            return {
                "success": False,
                "error": f"画像処理エラー: {str(e)}"
            }

    def _extract_with_document_ai(self, file_content: bytes, mime_type: str) -> Dict[str, Any]:
        """Google Cloud Document AIを使用してテキストを抽出"""
        try:
            # Document AI processor name
            name = f"projects/{self.project_id}/locations/{self.location}/processors/{self.processor_id}"
            
            # Raw document
            raw_document = documentai.RawDocument(content=file_content, mime_type=mime_type)
            
            # Process request
            request = documentai.ProcessRequest(name=name, raw_document=raw_document)
            result = self.document_ai_client.process_document(request=request)
            
            # Extract text
            text = result.document.text
            
            return {
                "success": True,
                "text": text.strip(),
                "method": "Document AI"
            }
            
        except Exception as e:
            return {
                "success": False,
                "error": f"Document AI処理エラー: {str(e)}"
            }

    def _extract_with_vision_api(self, file_content: bytes) -> Dict[str, Any]:
        """Google Cloud Vision APIを使用してOCR"""
        try:
            image = vision.Image(content=file_content)
            response = self.vision_client.text_detection(image=image)
            
            if response.error.message:
                raise Exception(f"Vision API error: {response.error.message}")
            
            texts = response.text_annotations
            if texts:
                text = texts[0].description
                return {
                    "success": True,
                    "text": text.strip(),
                    "method": "Vision API OCR"
                }
            else:
                return {
                    "success": True,
                    "text": "",
                    "method": "Vision API OCR",
                    "note": "テキストが検出されませんでした"
                }
                
        except Exception as e:
            return {
                "success": False,
                "error": f"Vision API処理エラー: {str(e)}"
            }

    # ------------------------------------------------------------------
    # 要約
    # ------------------------------------------------------------------
    def summarize_text(self, text: str, speaker_mode: str = "single",
                       speaker_names: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """テキストを音声読み上げ向けに要約する（google.genai を使用）"""
        try:
            names = speaker_names or {}
            name_a = names.get("A") or "話者A"
            name_b = names.get("B") or "話者B"
            if speaker_mode == "single":
                prompt = f"""
以下の文書の内容を、音声読み上げに適した形で要約してください。

要約の条件:
1. 重要なポイントを漏らさずに簡潔にまとめる
2. 音声で聞いた時に理解しやすい構造にする
3. 専門用語は必要に応じて説明を加える
4. 自然な日本語で、読み上げに適した文体にする
5. 一人の話者が読み上げる形式で要約する
6. 要約内容のみを出力し、説明文や前置きは不要
7. 「要約します」「以下のような内容です」等の文言は含めない

文書内容:
{text}
"""
            else:
                prompt = f"""
以下の文書の内容を、2人の話者（{name_a}、{name_b}）が会話する形式で要約してください。

要約の条件:
1. 文書の重要なポイントを会話形式で分かりやすく説明
2. {name_a} と {name_b} が交互に話す自然な会話形式
3. 専門用語や重要な概念は会話の中で説明
4. 各発言は1〜2文程度で簡潔に
5. 文書の内容を正確に反映した会話内容
6. 音声読み上げに適した自然な日本語
7. 要約内容のみを出力し、前置きは不要

出力形式:
{name_a}: [発言内容]
{name_b}: [発言内容]
{name_a}: [発言内容]
...

文書内容:
{text}
"""
            summary = generate_text(prompt)
            if summary:
                return {"success": True, "summary": summary, "speaker_mode": speaker_mode}
            return {"success": False, "error": "要約の生成に失敗しました"}
        except Exception as e:
            print(f"Summarization error: {e}")
            traceback.print_exc()
            return {"success": False, "error": f"要約生成エラー: {str(e)}"}

    # ------------------------------------------------------------------
    # 音声生成
    # ------------------------------------------------------------------
    def _resolve_model(self, model_key: Optional[str]) -> str:
        return TTS_MODELS.get(model_key or DEFAULT_TTS_MODEL, TTS_MODELS[DEFAULT_TTS_MODEL])["id"]

    @staticmethod
    def _needs_turn_annotations(model_id: str) -> bool:
        return any(m["id"] == model_id and m.get("turn_annotations") for m in TTS_MODELS.values())

    @staticmethod
    def _retry_once(call):
        """500系は1回だけ再試行。"""
        try:
            return call()
        except Exception as api_error:
            s = str(api_error)
            if "500" in s or "INTERNAL" in s or "503" in s:
                print(f"TTS API error {s[:120]} → 3秒後に再試行")
                time.sleep(3)
                return call()
            raise

    def _call_tts(self, model_id: str, prompt: str, speech_config: types.SpeechConfig) -> Optional[bytes]:
        """generate_content で音声を生成し、WAV バイト列を返す。"""
        cfg = types.GenerateContentConfig(response_modalities=["AUDIO"], speech_config=speech_config)
        response = self._retry_once(
            lambda: self.client.models.generate_content(model=model_id, contents=prompt, config=cfg))
        if response and getattr(response, "candidates", None):
            cand = response.candidates[0]
            parts = getattr(getattr(cand, "content", None), "parts", None) or []
            for part in parts:
                inline = getattr(part, "inline_data", None)
                if inline is not None and getattr(inline, "data", None):
                    return wave_file(inline.data)
                if getattr(part, "text", None):
                    print(f"TTS: 音声ではなくテキストが返却されました: {part.text[:200]}")
        return None

    def _call_tts_turns(self, model_id: str, turns: list, speakers: Dict[str, str], style: str) -> Optional[bytes]:
        """
        Interactions API で2話者会話を生成し、WAV バイト列を返す。
        turns: [(話者名, セリフ)], speakers: {話者名: 音声名}
        google-genai < 2.25 は speech_metadata を正しく送れないため REST で呼ぶ。
        """
        content = []
        for speaker, line in turns:
            meta = {"type": "speech_metadata", "speaker": speaker}
            if style:
                meta["style"] = style
            content.append({"type": "text", "text": line, "annotations": [meta]})
        result = self._retry_once(lambda: interactions_create(
            model_id,
            [{"type": "user_input", "content": content}],
            rest=True,
            response_format={"type": "audio"},
            generation_config={"speech_config": {
                "speakers": [{"speaker": s, "voice": v} for s, v in speakers.items()],
            }},
        ))
        if not result["audios"]:
            if result["text"]:
                print(f"TTS: 音声ではなくテキストが返却されました: {result['text'][:200]}")
            return None
        audio = result["audios"][0]
        data = base64.b64decode(audio["data"])
        return data if "wav" in (audio.get("mime_type") or "") else wave_file(data)

    @staticmethod
    def _split_turns(speaker_text: str, names: list) -> list:
        """「名前: セリフ」形式の会話を [(名前, セリフ)] に分割する。名前の無い行は直前のセリフに続ける。"""
        turns = []
        for line in speaker_text.split("\n"):
            line = line.strip()
            if not line:
                continue
            for name in names:
                if line.startswith(name):
                    rest = line[len(name):].lstrip()
                    if rest[:1] in (":", "："):
                        turns.append([name, rest[1:].strip()])
                        break
            else:
                if turns:
                    turns[-1][1] += "\n" + line
                else:
                    turns.append([names[0], line])
        return [(n, t) for n, t in turns if t]

    @staticmethod
    def _voice(name: str) -> types.VoiceConfig:
        return types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=name))

    def generate_speech(self, text: str, voice_settings: Dict[str, Any],
                        speaker_mode: str = "single", style: str = "",
                        rate: float = 1.0, model_key: Optional[str] = None) -> Dict[str, Any]:
        """
        テキストから音声を生成する。
        voice_settings:
          single: {"voice": "Kore"}
          multi : {"voiceA": "Kore", "voiceB": "Puck", "nameA": "話者A", "nameB": "話者B"}
        style: 自然言語のスタイル指示（[whispers] 等のインラインタグは text 内に直接書ける）
        """
        try:
            model_id = self._resolve_model(model_key)
            print(f"TTS生成開始: model={model_id}, speaker_mode={speaker_mode}, voice_settings={voice_settings}")

            style_line = f"音声スタイル: {style}\n\n" if style else ""
            if rate and abs(float(rate) - 1.0) > 0.05:
                style_line += f"話す速さ: 通常の{float(rate):.2f}倍\n\n"

            if speaker_mode == "single":
                voice_name = voice_settings.get("voice", "Kore")
                prompt = f"{style_line}{text}"
                speech_config = types.SpeechConfig(voice_config=self._voice(voice_name))
            else:
                voice_a = voice_settings.get("voiceA", "Kore")
                voice_b = voice_settings.get("voiceB", "Puck")
                name_a = (voice_settings.get("nameA") or "話者A").strip()
                name_b = (voice_settings.get("nameB") or "話者B").strip()

                speaker_text = text
                if not any(k in text for k in (":", "：", name_a, name_b)):
                    lines = [l.strip() for l in text.split("\n") if l.strip()]
                    speaker_text = "\n".join(
                        f"{name_a if i % 2 == 0 else name_b}: {l}" for i, l in enumerate(lines)
                    )
                # 旧形式（話者A/話者B）で書かれていても指定名に置換
                speaker_text = speaker_text.replace("話者A:", f"{name_a}:").replace("話者B:", f"{name_b}:")
                prompt = f"{style_line}以下の会話を{name_a}と{name_b}の2人の話者で読み上げてください:\n{speaker_text}"
                turns = self._split_turns(speaker_text, [name_a, name_b])
                turn_style = style_line.replace("\n\n", " ").strip()
                speech_config = types.SpeechConfig(
                    multi_speaker_voice_config=types.MultiSpeakerVoiceConfig(
                        speaker_voice_configs=[
                            types.SpeakerVoiceConfig(speaker=name_a, voice_config=self._voice(voice_a)),
                            types.SpeakerVoiceConfig(speaker=name_b, voice_config=self._voice(voice_b)),
                        ]
                    )
                )

            def synthesize(mid: str) -> Optional[bytes]:
                if speaker_mode != "single" and self._needs_turn_annotations(mid):
                    return self._call_tts_turns(mid, turns, {name_a: voice_a, name_b: voice_b}, turn_style)
                return self._call_tts(mid, prompt, speech_config)

            try:
                wav = synthesize(model_id)
            except Exception as e:
                # 選択したモデルが使えない場合は 3.1 Flash へフォールバック
                fallback = TTS_MODELS["flash-3.1"]["id"]
                if model_id != fallback and ("404" in str(e) or "not found" in str(e).lower()):
                    print(f"{model_id} が利用できないため {fallback} にフォールバック")
                    model_id = fallback
                    wav = synthesize(model_id)
                else:
                    raise

            if not wav:
                return {"success": False, "error": "音声データの生成に失敗しました - 応答に音声が含まれていません"}

            wav_b64 = base64.b64encode(wav).decode("utf-8")
            return {"success": True, "audio_data": wav_b64, "format": "wav", "model": model_id}
        except Exception as e:
            print(f"Speech generation error: {e}")
            traceback.print_exc()
            return {"success": False, "error": f"音声生成エラー: {str(e)}"}

    def preview_voice(self, voice: str, text: str = "こんにちは。これは音声のプレビューです。",
                      style: str = "", model_key: Optional[str] = None) -> Dict[str, Any]:
        return self.generate_speech(text, {"voice": voice}, "single", style, 1.0, model_key)

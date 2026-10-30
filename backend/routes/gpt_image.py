"""
画像生成 (OpenAI GPT Image 2.5) + PPTX スライド再作成
https://developers.openai.com/api/docs/guides/image-generation
"""
import io
import json
import base64
import subprocess
from concurrent.futures import ThreadPoolExecutor

from flask import Blueprint, request, jsonify, send_file

from gemini_client import enhance_prompt, to_data_url, api_error_response, generate_json, genai_types
from openai_client import is_available, fit_size, images_generate, images_edit, responses_json, PLANNER_MODEL
from pptx_tools import parse_pptx, build_pptx

bp = Blueprint("gpt_image", __name__)

GPT_IMAGE_MODELS = {
    "flare":    {"id": "gpt-image-2.5-flare"},
    "sunburst": {"id": "gpt-image-2.5-sunburst"},
}
QUALITIES = ["auto", "low", "medium", "high", "xhigh", "max"]
BACKGROUNDS = ["auto", "opaque", "transparent"]
OUTPUT_FORMATS = ["png", "jpeg", "webp"]
ASPECT_RATIOS = ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"]
LONG_EDGES = [1024, 1536, 2560, 3840]  # 2560x1440 超は実験的
MAX_INPUT_IMAGES = 16
MAX_SLIDES = 80
MAX_NOTES_CHARS = 2000
PLAN_CHUNK = 10  # 演出プランを1回で考えるスライド数

# 演出プランを考える汎用モデル（Gemini は GOOGLE_API_KEY で動くので OpenAI のクレジットを使わない）
PLANNERS = {
    "gemini-lite": {"provider": "gemini", "models": ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-flash-lite-latest"]},
    "gemini":      {"provider": "gemini", "models": ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-flash-latest"]},
    "gpt":         {"provider": "openai", "models": [PLANNER_MODEL]},
}
DEFAULT_PLANNER = "gemini-lite"

ENHANCE_INSTRUCTION = (
    "You are a helpful assistant specializing in crafting effective prompts for AI image generation. "
    "Take the user's request (usually Japanese) and transform it into a detailed, descriptive English prompt. "
    "Focus on visual details, style, composition, lighting and mood. "
    "If the image must contain text, keep that text EXACTLY as the user wrote it (do not translate it). "
    "Output ONLY the final prompt, without any explanation."
)

# スライド再作成は2段階: ① 汎用モデルが「どう見せるか」を計画 ② 画像モデルが元画像なしで新規生成
# （GPT Image 2 以降は入力画像を常に高忠実度で扱うため、元スライドを入力すると元のレイアウトに引きずられる）
PLAN_INSTRUCTION = """You are an award-winning presentation designer and visual storyteller.
You receive the content of a slide deck (slide text, tables, speaker notes and an image of each original slide)
and plan how to redesign every slide as a striking, image-generated slide.
OUTPUT LANGUAGE: write design_system and every concept in Japanese (日本語で書くこと). Quote slide text verbatim.

1. design_system: ONE visual identity for the whole deck, concrete enough that an image model reproduces it
   identically on every slide: background, color palette with hex codes, typography (Japanese gothic style, weights,
   relative sizes of title/body), margins and grid, title treatment, illustration style (e.g. flat vector people,
   isometric, soft 3D, photo), icon style, chart style, recurring motifs, footer. 150-300 characters.
2. slides[].concept: for each slide, HOW to visualize its message (120-250 characters). Choose the most effective
   storytelling, as a top designer would:
   - scenes with people suited to the content and audience (who, doing what, expression); default to Japanese
     people and settings unless the content says otherwise. Prefer people over empty rooms or abstract
     backgrounds: use people (illustrated or photo, matching the design system) on roughly half of the slides,
     wherever the message involves someone (learners, teachers, staff, customers, users),
   - visual metaphors, icons, diagrams (flow, cycle, hierarchy, comparison, timeline, matrix),
   - tables and numbers as charts or big-number callouts,
   - title, section and closing slides with a strong hero visual.
   State the composition (where the title, each text block and the visuals go) and which text goes where.
   Vary compositions between slides while staying inside the design system.

Rules:
- The slide text is rendered EXACTLY as given. Never reword, translate, summarize or add text (no extra captions,
  labels or slogans). Every text item must have a place in the composition.
- Speaker notes are only context for the intent; they never appear on the slide.
- If the original has photos, charts or diagrams, decide whether to keep them (describe them) or replace them with a
  better visualization.
- Follow the user's style request and per-slide requests."""

LAYOUT_FREEDOM = {
    "redesign": "Layout freedom: FREE. Choose the best composition for each message; it may be completely different from the original.",
    "keep": "Layout freedom: CLOSE. Keep the original information structure and reading order, but upgrade visuals and add illustrations.",
}

_PLAN_ITEM = {
    "type": "object",
    "properties": {"index": {"type": "integer"}, "concept": {"type": "string", "description": "日本語で書く"}},
    "required": ["index", "concept"],
    "additionalProperties": False,
}
PLAN_SCHEMA = {
    "type": "object",
    "properties": {"design_system": {"type": "string", "description": "日本語で書く"}, "slides": {"type": "array", "items": _PLAN_ITEM}},
    "required": ["design_system", "slides"],
    "additionalProperties": False,
}
PLAN_SCHEMA_SLIDES = {
    "type": "object",
    "properties": {"slides": {"type": "array", "items": _PLAN_ITEM}},
    "required": ["slides"],
    "additionalProperties": False,
}


def _model(options):
    return GPT_IMAGE_MODELS.get(options.get("model"), GPT_IMAGE_MODELS["flare"])["id"]


def _ratio(ar: str) -> float:
    w, h = ar.split(":")
    return int(w) / int(h)


def _common_params(options, size):
    quality = options.get("quality")
    background = options.get("background")
    fmt = options.get("output_format")
    return {
        "size": size,
        "quality": quality if quality in QUALITIES else "auto",
        "background": background if background in BACKGROUNDS else "auto",
        "output_format": fmt if fmt in OUTPUT_FORMATS else "png",
        "output_compression": 90 if fmt in ("jpeg", "webp") else None,
    }


def _decode_inputs(images, prefix="input"):
    out = []
    for i, img in enumerate(images or []):
        mime = (img.get("mime_type") or "").lower()
        b64 = img.get("data")
        if not mime or not b64:
            continue
        ext = mime.split("/")[-1].replace("jpg", "jpeg")
        out.append((f"{prefix}_{i + 1}.{ext}", base64.b64decode(b64), mime))
    return out


def _unavailable():
    return jsonify({
        "error": "OPENAI_API_KEY が設定されていません。backend/.env に追加してコンテナを再起動してください。",
        "error_type": "not_configured",
    }), 503


@bp.route("/api/gpt-image/models")
def gpt_image_models():
    return jsonify({
        "available": is_available(),
        "models": [{"key": k, **v} for k, v in GPT_IMAGE_MODELS.items()],
        "qualities": QUALITIES,
        "backgrounds": BACKGROUNDS,
        "output_formats": OUTPUT_FORMATS,
        "aspect_ratios": ASPECT_RATIOS,
        "long_edges": LONG_EDGES,
        "max_input_images": MAX_INPUT_IMAGES,
        "max_slides": MAX_SLIDES,
        "planners": [{"key": k, "provider": v["provider"], "id": v["models"][0]} for k, v in PLANNERS.items()],
        "default_planner": DEFAULT_PLANNER,
    })


@bp.route("/api/gpt-image/generate", methods=["POST"])
def generate():
    if not is_available():
        return _unavailable()
    try:
        data = request.get_json() or {}
        prompt = (data.get("prompt") or "").strip()
        images = data.get("images_data") or []
        options = data.get("options") or {}

        if not prompt:
            return jsonify({"error": "プロンプトを入力してください。"}), 400
        if not isinstance(images, list):
            images = []
        if len(images) > MAX_INPUT_IMAGES:
            return jsonify({"error": f"入力画像は最大{MAX_INPUT_IMAGES}枚までです。"}), 400

        model = _model(options)
        processed = enhance_prompt(ENHANCE_INSTRUCTION, prompt) if options.get("enhance_prompt") else prompt

        ar = options.get("aspect_ratio")
        size = "auto"
        if ar in ASPECT_RATIOS and ar != "auto":
            edge = options.get("long_edge") if options.get("long_edge") in LONG_EDGES else 1536
            size = fit_size(_ratio(ar), edge)
        params = _common_params(options, size)
        n = min(4, max(1, int(options.get("n") or 1)))

        inputs = _decode_inputs(images)
        print(f"GPT image: model={model}, size={size}, quality={params['quality']}, n={n}, images={len(inputs)}")
        if inputs:
            out = images_edit(model, processed, inputs, n=n, **params)
        else:
            out = images_generate(model, processed, n=n, **params)
        if not out:
            return jsonify({"error": "モデルから画像が返されませんでした。プロンプトを変えて再試行してください。"}), 500

        return jsonify({
            "results": [{"type": "image", "content": to_data_url(o["data"], o["mime_type"]), "mime_type": o["mime_type"]} for o in out],
            "model": model,
            "size": size,
            "prompt_used": processed,
        })
    except Exception as e:
        return api_error_response(e, "画像生成")


# ---------------------------------------------------------------------------
# PPTX スライド再作成
# ---------------------------------------------------------------------------
@bp.route("/api/gpt-image/pptx/parse", methods=["POST"])
def pptx_parse():
    f = request.files.get("file")
    if not f or not f.filename.lower().endswith(".pptx"):
        return jsonify({"error": "PPTX ファイルを選択してください。"}), 400
    try:
        result = parse_pptx(f.read())
    except subprocess.TimeoutExpired:
        return jsonify({"error": "スライドの画像化がタイムアウトしました。スライド数を減らして再試行してください。"}), 504
    except FileNotFoundError:
        return jsonify({"error": "LibreOffice (soffice) がサーバーにインストールされていません。"}), 500
    except Exception as e:
        print(f"pptx parse error: {e}")
        return jsonify({"error": f"PPTX の読み込みに失敗しました: {e}"}), 400
    if len(result["slides"]) > MAX_SLIDES:
        return jsonify({"error": f"スライドは最大{MAX_SLIDES}枚までです（{len(result['slides'])}枚）。"}), 400
    if not result["slides"]:
        return jsonify({"error": "スライドが含まれていません。"}), 400
    return jsonify(result)


def _text_lines(slide):
    lines = []
    for t in slide.get("texts") or []:
        lines += [ln.strip() for ln in str(t).splitlines() if ln.strip()]
    return lines


def _tables_block(slide):
    out = []
    for i, rows in enumerate(slide.get("tables") or [], 1):
        out.append(f"Table {i}:")
        out += [" | ".join(r) for r in rows]
    return "\n".join(out)


def _slide_brief(slide):
    """プランナーに渡す1枚分の説明"""
    parts = [f"--- Slide {slide.get('index')}{' (title slide)' if slide.get('index') == 1 else ''} ---"]
    lines = _text_lines(slide)
    parts.append("Text:\n" + ("\n".join(lines) if lines else "(no text)"))
    tables = _tables_block(slide)
    if tables:
        parts.append(tables)
    if slide.get("has_visual"):
        parts.append("The original contains photos or charts (see thumbnail).")
    notes = (slide.get("notes") or "").strip()[:MAX_NOTES_CHARS]
    if notes:
        parts.append("Speaker notes: " + notes)
    if (slide.get("instruction") or "").strip():
        parts.append("User request for this slide: " + slide["instruction"].strip())
    return "\n".join(parts)


def _plan_chunk(planner, slides, deck_header, design_system=None):
    """テキストと元スライド画像を交互に並べてプランナーへ渡す。戻り値: (dict, 使用モデル)"""
    texts = [deck_header]
    if design_system:
        texts.append("DESIGN SYSTEM (fixed, already decided; plan only the slides below):\n" + design_system)
    schema, name = (PLAN_SCHEMA_SLIDES, "slide_plans") if design_system else (PLAN_SCHEMA, "deck_plan")
    gemini = planner["provider"] == "gemini"
    content = [genai_types.Part.from_text(text=t) if gemini else {"type": "input_text", "text": t} for t in texts]
    for sl in slides:
        brief = _slide_brief(sl)
        content.append(genai_types.Part.from_text(text=brief) if gemini else {"type": "input_text", "text": brief})
        if sl.get("image"):
            if gemini:
                content.append(genai_types.Part.from_bytes(data=base64.b64decode(sl["image"]), mime_type="image/jpeg"))
            else:
                content.append({"type": "input_image", "image_url": f"data:image/jpeg;base64,{sl['image']}", "detail": "high"})
    if gemini:
        return generate_json(planner["models"], PLAN_INSTRUCTION, content, schema)
    return responses_json(PLAN_INSTRUCTION, content, schema, name)


@bp.route("/api/gpt-image/pptx/plan", methods=["POST"])
def pptx_plan():
    try:
        data = request.get_json() or {}
        slides = data.get("slides") or []
        options = data.get("options") or {}
        planner = PLANNERS.get(options.get("planner"), PLANNERS[DEFAULT_PLANNER])
        if planner["provider"] == "openai" and not is_available():
            return _unavailable()
        if not slides:
            return jsonify({"error": "スライドがありません。"}), 400
        if len(slides) > MAX_SLIDES:
            return jsonify({"error": f"スライドは最大{MAX_SLIDES}枚までです。"}), 400

        outline = "\n".join(f"{s.get('index')}. {s.get('title') or (_text_lines(s) or [''])[0]}" for s in slides)
        header = "\n".join(filter(None, [
            f"Deck: {options.get('filename') or 'presentation'} ({options.get('total') or len(slides)} slides, aspect {float(options.get('aspect') or 16 / 9):.2f}:1)",
            "Outline:\n" + outline,
            LAYOUT_FREEDOM.get(options.get("layout"), LAYOUT_FREEDOM["redesign"]),
            ("User style request: " + options["style"].strip()) if (options.get("style") or "").strip() else
            "User style request: none — choose a modern, professional style that suits the content and audience.",
        ]))

        chunks = [slides[i:i + PLAN_CHUNK] for i in range(0, len(slides), PLAN_CHUNK)]
        design_system = (options.get("design_system") or "").strip()  # 指定時は既存デザインを固定
        if design_system:
            first, model = _plan_chunk(planner, chunks[0], header, design_system)
        else:
            first, model = _plan_chunk(planner, chunks[0], header)
            design_system = first["design_system"]
        plans = list(first["slides"])
        if len(chunks) > 1:
            with ThreadPoolExecutor(max_workers=3) as ex:
                for res, _ in ex.map(lambda c: _plan_chunk(planner, c, header, design_system), chunks[1:]):
                    plans += res["slides"]
        print(f"GPT plan: model={model}, slides={len(slides)}, chunks={len(chunks)}")
        return jsonify({"design_system": design_system, "slides": plans, "model": model})
    except Exception as e:
        return api_error_response(e, "演出プラン作成")


def _slide_prompt(slide, plan, options, refs_note):
    lines = _text_lines(slide)
    tables = _tables_block(slide)
    notes = (slide.get("notes") or "").strip()[:MAX_NOTES_CHARS]
    out = [
        f"Design slide {slide.get('index', 1)} of {options.get('total') or '?'} of a presentation deck as one finished, "
        "full-bleed slide image (flat graphic; no device mockup, no border, no perspective).",
        "",
        "DECK DESIGN SYSTEM — apply identically on every slide of the deck:",
        (plan.get("design_system") or "").strip() or "Modern, clean and professional.",
        "",
        "VISUAL CONCEPT FOR THIS SLIDE:",
        (plan.get("concept") or "").strip() or "Visualize the message with fitting illustrations, icons or diagrams.",
    ]
    extra = (slide.get("instruction") or "").strip()
    if extra:
        out += ["", f"Additional request: {extra}"]
    out += [
        "",
        "TEXT — render every line below exactly as written: same characters, same Japanese, same numbers and symbols. "
        "Do not translate, paraphrase, abbreviate or omit any line, and do not add any other words. "
        "Place and style the text freely to fit the concept with a clear hierarchy (line 1 is usually the title). "
        "Text must be sharp, correctly spelled and legible.",
    ]
    out += [f"{i}. 「{ln}」" for i, ln in enumerate(lines, 1)] or ["(This slide has no text. Do not add any text.)"]
    if tables:
        out += ["", "DATA — show every value below exactly (as a styled table or an accurately labelled chart):", tables]
    if refs_note:
        out += ["", *refs_note]
    if notes:
        out += ["", "Speaker notes (context only; never render them):", notes]
    return "\n".join(out)


@bp.route("/api/gpt-image/slide", methods=["POST"])
def recreate_slide():
    if not is_available():
        return _unavailable()
    try:
        data = request.get_json() or {}
        slide = data.get("slide") or {}
        plan = data.get("plan") or {}
        options = data.get("options") or {}

        model = _model(options)
        aspect = float(options.get("aspect") or 16 / 9)
        edge = options.get("long_edge") if options.get("long_edge") in LONG_EDGES else 1536
        size = fit_size(aspect, edge)
        params = _common_params({**options, "background": "opaque"}, size)

        # 入力画像: 統一用の見本スライド → ユーザー参考画像 → （任意）元スライド
        inputs, notes = [], []
        refs = data.get("style_refs") or []
        anchor = [r for r in refs if r.get("role") == "anchor"][:1]
        user_refs = [r for r in refs if r.get("role") != "anchor"][:4]
        if anchor:
            inputs += _decode_inputs(anchor, prefix="deck_style")
            notes.append(
                f"Image {len(inputs)} is an already finished slide of the SAME deck. Use it ONLY as the style reference: "
                "match its colors, typography, background, illustration rendering and title treatment exactly. "
                "Do NOT copy its layout, composition, illustrations or text — this slide gets its own composition from the concept above."
            )
        if user_refs:
            start = len(inputs) + 1
            inputs += _decode_inputs(user_refs, prefix="brand")
            notes.append(
                f"Image(s) {start}-{len(inputs)} are brand/style references from the user (logo, template or preferred look). "
                "Follow them; place a logo small and in the same spot on every slide."
            )
        if slide.get("use_original") and slide.get("image"):
            inputs.append(("original_slide.jpeg", base64.b64decode(slide["image"]), "image/jpeg"))
            notes.append(
                f"Image {len(inputs)} is the ORIGINAL slide. Use it only as a source for its photos, charts, diagrams and data; "
                "do not copy its layout or design."
            )
        prompt = _slide_prompt(slide, plan, options, notes)

        print(f"GPT slide: model={model}, slide={slide.get('index')}, size={size}, quality={params['quality']}, inputs={len(inputs)}")
        out = images_edit(model, prompt, inputs, **params) if inputs else images_generate(model, prompt, **params)
        if not out:
            return jsonify({"error": "モデルから画像が返されませんでした。再試行してください。"}), 500
        o = out[0]
        return jsonify({
            "image": to_data_url(o["data"], o["mime_type"]),
            "mime_type": o["mime_type"],
            "model": model,
            "size": size,
            "prompt_used": prompt,
        })
    except Exception as e:
        return api_error_response(e, "スライド再作成")


@bp.route("/api/gpt-image/pptx/build", methods=["POST"])
def pptx_build():
    try:
        meta = json.loads(request.form.get("meta") or "{}")
        width, height = int(meta["slide_width"]), int(meta["slide_height"])
        slides = []
        for i, s in enumerate(meta.get("slides") or []):
            f = request.files.get(f"image_{i}")
            if not f:
                return jsonify({"error": f"スライド{i + 1}の画像がありません。"}), 400
            slides.append({"image": f.read(), "notes": s.get("notes") or ""})
        if not slides:
            return jsonify({"error": "スライドがありません。"}), 400
        data = build_pptx(width, height, slides)
        name = (meta.get("filename") or "slides").rsplit(".", 1)[0]
        return send_file(
            io.BytesIO(data),
            mimetype="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            as_attachment=True,
            download_name=f"{name}_gpt.pptx",
        )
    except Exception as e:
        print(f"pptx build error: {e}")
        return jsonify({"error": f"PPTX の作成に失敗しました: {e}"}), 500

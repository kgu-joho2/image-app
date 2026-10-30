"""
PPTX の読み込み（スライド画像化 + テキスト/ノート抽出）と、画像からの PPTX 組み立て。
ファイルは要求ごとの一時ディレクトリで処理し、サーバーには残さない。
"""
import io
import os
import base64
import subprocess
import tempfile
from typing import List

from pptx import Presentation
from pptx.util import Emu

RENDER_LONG_EDGE = 1536
SOFFICE_TIMEOUT = 300
# 非表示スライドも含めて書き出し、python-pptx のスライド順と一致させる
PDF_FILTER = 'pdf:impress_pdf_Export:{"ExportHiddenSlides":{"type":"boolean","value":"true"},"ExportNotesPages":{"type":"boolean","value":"false"}}'


def _collect(shapes, out):
    """テキスト・表・図（写真/グラフ）の有無を out に集める"""
    for shape in shapes:
        if shape.shape_type == 6 and hasattr(shape, "shapes"):  # グループ
            _collect(shape.shapes, out)
        elif getattr(shape, "has_table", False) and shape.has_table:
            rows = [[c.text.strip() for c in row.cells] for row in shape.table.rows]
            rows = [r for r in rows if any(r)]
            if rows:
                out["tables"].append(rows)
        elif getattr(shape, "has_chart", False) and shape.has_chart:
            out["has_visual"] = True
        elif hasattr(shape, "image"):  # 写真・画像プレースホルダ
            out["has_visual"] = True
        elif getattr(shape, "has_text_frame", False) and shape.has_text_frame:
            t = shape.text_frame.text.strip()
            if t:
                out["texts"].append(t)
    return out


def _render_slides(pptx_bytes: bytes, workdir: str) -> List[str]:
    """LibreOffice で PDF 化 → PyMuPDF で各ページを JPEG(b64) 化"""
    import pymupdf

    src = os.path.join(workdir, "deck.pptx")
    with open(src, "wb") as f:
        f.write(pptx_bytes)
    profile = "file://" + os.path.join(workdir, "lo-profile")
    subprocess.run(
        ["soffice", f"-env:UserInstallation={profile}", "--headless", "--norestore",
         "--convert-to", PDF_FILTER, "--outdir", workdir, src],
        check=True, timeout=SOFFICE_TIMEOUT, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    pdf_path = os.path.join(workdir, "deck.pdf")
    if not os.path.exists(pdf_path):
        raise RuntimeError("スライドの画像化に失敗しました（PDF が生成されませんでした）。")

    images = []
    with pymupdf.open(pdf_path) as doc:
        for page in doc:
            r = page.rect
            zoom = RENDER_LONG_EDGE / max(r.width, r.height)
            pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
            images.append(base64.b64encode(pix.tobytes("jpeg", jpg_quality=92)).decode("ascii"))
    return images


def parse_pptx(pptx_bytes: bytes) -> dict:
    prs = Presentation(io.BytesIO(pptx_bytes))
    slides = []
    for i, slide in enumerate(prs.slides):
        title = ""
        if slide.shapes.title is not None and slide.shapes.title.has_text_frame:
            title = slide.shapes.title.text_frame.text.strip()
        notes = ""
        if slide.has_notes_slide and slide.notes_slide.notes_text_frame is not None:
            notes = slide.notes_slide.notes_text_frame.text.strip()
        content = _collect(slide.shapes, {"texts": [], "tables": [], "has_visual": False})
        slides.append({
            "index": i + 1,
            "title": title,
            **content,
            "notes": notes,
            "hidden": slide._element.get("show") == "0",
            "image": None,
        })

    with tempfile.TemporaryDirectory(prefix="pptx-") as workdir:
        images = _render_slides(pptx_bytes, workdir)
    if len(images) == len(slides):
        for s, img in zip(slides, images):
            s["image"] = img
    else:
        print(f"parse_pptx: page count mismatch (pdf={len(images)}, slides={len(slides)})")

    width, height = int(prs.slide_width), int(prs.slide_height)
    return {
        "slide_width": width,
        "slide_height": height,
        "aspect": width / height,
        "slides": slides,
        "rendered": all(s["image"] for s in slides),
    }


def build_pptx(slide_width: int, slide_height: int, slides: List[dict]) -> bytes:
    """slides: [{"image": bytes, "notes": str}] → 画像を全面に配置した PPTX"""
    prs = Presentation()
    prs.slide_width, prs.slide_height = Emu(slide_width), Emu(slide_height)
    blank = prs.slide_layouts[6]
    for s in slides:
        slide = prs.slides.add_slide(blank)
        slide.shapes.add_picture(io.BytesIO(s["image"]), 0, 0, width=prs.slide_width, height=prs.slide_height)
        if s.get("notes"):
            slide.notes_slide.notes_text_frame.text = s["notes"]
    out = io.BytesIO()
    prs.save(out)
    return out.getvalue()


__all__ = ["parse_pptx", "build_pptx"]

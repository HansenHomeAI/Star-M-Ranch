from __future__ import annotations

def decode_upload(contents: bytes, filename: str, content_type: str | None = None) -> np.ndarray:
    import cv2
    import numpy as np

    lower_name = filename.lower()
    if lower_name.endswith(".pdf") or content_type == "application/pdf":
        return _decode_pdf_first_page(contents)

    array = np.frombuffer(contents, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Unsupported or unreadable image file.")
    return image


def decode_hint(contents: bytes) -> np.ndarray:
    import cv2
    import numpy as np

    array = np.frombuffer(contents, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise ValueError("Unsupported or unreadable hint image.")
    _, mask = cv2.threshold(image, 20, 255, cv2.THRESH_BINARY)
    return mask


def encode_png(image: np.ndarray) -> bytes:
    import cv2

    ok, encoded = cv2.imencode(".png", image)
    if not ok:
        raise ValueError("Failed to encode PNG.")
    return encoded.tobytes()


def _decode_pdf_first_page(contents: bytes) -> np.ndarray:
    import cv2
    import numpy as np
    import pypdfium2 as pdfium
    from PIL import Image

    document = pdfium.PdfDocument(contents)
    if len(document) == 0:
        raise ValueError("PDF has no pages.")
    page = document[0]
    bitmap = page.render(scale=2.0)
    pil_image: Image.Image = bitmap.to_pil().convert("RGB")
    return cv2.cvtColor(np.array(pil_image), cv2.COLOR_RGB2BGR)

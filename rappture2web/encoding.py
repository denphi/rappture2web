"""Handle Rappture encoding/decoding for binary data.

Rappture uses special markers for encoded data:
- @@RP-ENC:b64  -> Base64 encoded
- @@RP-ENC:zb64 -> Zlib compressed + Base64 encoded
"""

import base64
import zlib


RPENC_RAW = 0
RPENC_B64 = 2
RPENC_Z = 1
RPENC_ZB64 = 3


def decode(data: str) -> bytes:
    """Decode Rappture-encoded data string to raw bytes."""
    data = data.strip()

    if data.startswith("@@RP-ENC:zb64\n"):
        payload = data[len("@@RP-ENC:zb64\n"):]
        raw = base64.b64decode(payload)
        return zlib.decompress(raw)
    elif data.startswith("@@RP-ENC:b64\n"):
        payload = data[len("@@RP-ENC:b64\n"):]
        return base64.b64decode(payload)
    else:
        # Try to decode as raw base64 (used in Rappture example XMLs)
        try:
            return base64.b64decode(data)
        except Exception:
            return data.encode("utf-8")


def encode(data: bytes, encoding: int = RPENC_ZB64) -> str:
    """Encode raw bytes into Rappture-encoded string."""
    if encoding == RPENC_B64:
        encoded = base64.b64encode(data).decode("ascii")
        return f"@@RP-ENC:b64\n{encoded}\n"
    elif encoding == RPENC_ZB64:
        compressed = zlib.compress(data)
        encoded = base64.b64encode(compressed).decode("ascii")
        return f"@@RP-ENC:zb64\n{encoded}\n"
    elif encoding == RPENC_Z:
        return zlib.compress(data)
    else:
        return data.decode("utf-8")


def is_encoded(data: str) -> bool:
    """Check if a string contains Rappture-encoded data."""
    stripped = data.strip()
    return stripped.startswith("@@RP-ENC:")


def to_data_uri(data: str, mime_type: str = "image/png") -> str:
    """Convert Rappture-encoded image data to a data URI for HTML display."""
    if is_encoded(data):
        raw_bytes = decode(data)
        b64 = base64.b64encode(raw_bytes).decode("ascii")
        return f"data:{mime_type};base64,{b64}"
    elif data.strip():
        # Assume raw base64
        return f"data:{mime_type};base64,{data.strip()}"
    return ""

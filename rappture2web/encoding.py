"""Handle Rappture encoding/decoding for binary data.

Rappture uses special markers for encoded data:
- @@RP-ENC:b64  -> Base64 encoded
- @@RP-ENC:zb64 -> Zlib compressed + Base64 encoded
"""

import base64
import re
import zlib


RPENC_RAW = 0
RPENC_B64 = 2
RPENC_Z = 1
RPENC_ZB64 = 3

# Cap decompressed output so a crafted (or accidentally huge) zb64 payload
# cannot exhaust memory. 256 MiB comfortably exceeds any legitimate Rappture
# field/image while bounding the blast radius of a zlib bomb.
_MAX_DECODED_BYTES = 256 * 1024 * 1024

# Marker + optional separator (newline, spaces, or none). data.strip() removes
# any trailing newline, so the payload may be adjacent to the marker.
_ZB64_RE = re.compile(r"^@@RP-ENC:zb64\s*", re.DOTALL)
_B64_RE = re.compile(r"^@@RP-ENC:b64\s*", re.DOTALL)


def _bounded_decompress(raw: bytes) -> bytes:
    """zlib-decompress *raw* but never allocate more than _MAX_DECODED_BYTES."""
    dobj = zlib.decompressobj()
    out = dobj.decompress(raw, _MAX_DECODED_BYTES)
    if dobj.unconsumed_tail:
        raise ValueError("compressed payload exceeds maximum decoded size")
    return out


def decode(data: str) -> bytes:
    """Decode Rappture-encoded data string to raw bytes.

    Malformed encoded payloads degrade to the raw fallback rather than raising,
    matching the un-prefixed base64 path.
    """
    data = data.strip()

    m = _ZB64_RE.match(data)
    if m:
        try:
            return _bounded_decompress(base64.b64decode(data[m.end():]))
        except Exception:
            return data.encode("utf-8")

    m = _B64_RE.match(data)
    if m:
        try:
            return base64.b64decode(data[m.end():])
        except Exception:
            return data.encode("utf-8")

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
        # Assume raw base64 — strip all whitespace (line-wrapped base64 is common)
        clean = re.sub(r'\s+', '', data)
        return f"data:{mime_type};base64,{clean}"
    return ""

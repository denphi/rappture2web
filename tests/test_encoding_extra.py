"""Additional encoding tests (complement existing suite)."""
from __future__ import annotations

import base64
import re

from rappture2web.encoding import decode, encode, is_encoded, to_data_uri, RPENC_B64, RPENC_ZB64


def test_encode_decode_roundtrip_zb64():
    data = b"hello world " * 100
    encoded = encode(data, RPENC_ZB64)
    assert encoded.startswith("@@RP-ENC:zb64\n")
    assert decode(encoded) == data


def test_encode_decode_roundtrip_b64():
    data = b"some binary \x00\x01\x02"
    encoded = encode(data, RPENC_B64)
    assert encoded.startswith("@@RP-ENC:b64\n")
    assert decode(encoded) == data


def test_is_encoded_true():
    assert is_encoded("@@RP-ENC:zb64\nabc")
    assert is_encoded("@@RP-ENC:b64\nabc")


def test_is_encoded_false():
    assert not is_encoded("plain text")
    assert not is_encoded("")


def test_to_data_uri_encoded():
    raw = b"\x89PNG"
    encoded = encode(raw, RPENC_B64)
    uri = to_data_uri(encoded, "image/png")
    assert uri.startswith("data:image/png;base64,")
    # Verify the decoded bytes match
    b64_part = uri.split(",", 1)[1]
    assert base64.b64decode(b64_part) == raw


def test_to_data_uri_raw_base64_no_whitespace():
    raw = b"PNG"
    b64 = base64.b64encode(raw).decode()
    uri = to_data_uri(b64, "image/png")
    assert uri.startswith("data:image/png;base64,")
    assert " " not in uri
    assert "\n" not in uri


def test_to_data_uri_empty_returns_empty():
    assert to_data_uri("") == ""
    assert to_data_uri("   ") == ""

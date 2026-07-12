"""Tests for session factory, _new_session, and _serialize helpers."""
from __future__ import annotations

from dataclasses import dataclass, field

from rappture2web.app import _new_session, _serialize


def test_new_session_structure():
    s = _new_session("abc123", {"t": "300"})
    assert s["job_id"] == "abc123"
    assert s["status"] == "running"
    assert s["inputs"] == {"t": "300"}
    assert s["outputs"] == {}
    assert s["log"] == ""
    assert s["run_id"] is None
    assert s["run_num"] is None
    assert s["cached"] is False
    assert s["progress"]["percent"] == 0


def test_new_session_defaults_to_idle_when_no_job():
    s = _new_session(None, {})
    assert s["job_id"] is None


# ── _serialize ────────────────────────────────────────────────────────────────

@dataclass
class _Inner:
    x: int = 1


@dataclass
class _Outer:
    name: str = "hello"
    inner: _Inner = field(default_factory=_Inner)
    items: list = field(default_factory=list)


def test_serialize_flat_dataclass():
    obj = _Inner(x=42)
    result = _serialize(obj)
    assert result == {"x": 42}


def test_serialize_nested_dataclass():
    obj = _Outer(name="test", inner=_Inner(x=7), items=[1, 2])
    result = _serialize(obj)
    assert result["name"] == "test"
    assert result["inner"] == {"x": 7}
    assert result["items"] == [1, 2]


def test_serialize_plain_dict():
    assert _serialize({"a": 1, "b": [2, 3]}) == {"a": 1, "b": [2, 3]}


def test_serialize_plain_list():
    assert _serialize([1, "two", 3.0]) == [1, "two", 3.0]


def test_serialize_scalar():
    assert _serialize(42) == 42
    assert _serialize("hi") == "hi"

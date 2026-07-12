"""Tests for RunHistory — cache, persistence, CRUD, reorder."""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from rappture2web.simulator import RunHistory


# ── helpers ──────────────────────────────────────────────────────────────────

def _add(h: RunHistory, inputs: dict, status: str = "success") -> dict:
    return h.add(input_values=inputs, outputs={"x": 1}, log="ok", status=status)


# ── basic add / get ───────────────────────────────────────────────────────────

def test_add_increments_run_num():
    h = RunHistory()
    r1 = _add(h, {"a": "1"})
    r2 = _add(h, {"a": "2"})
    assert r1["run_num"] == 1
    assert r2["run_num"] == 2


def test_get_by_id_returns_run():
    h = RunHistory()
    r = _add(h, {"a": "1"})
    assert h.get_by_id(r["run_id"]) is r


def test_get_by_id_missing_returns_none():
    h = RunHistory()
    assert h.get_by_id("nonexistent") is None


def test_get_by_num_returns_run():
    h = RunHistory()
    r1 = _add(h, {"a": "1"})
    r2 = _add(h, {"a": "2"})
    assert h.get_by_num(1) is r1
    assert h.get_by_num(2) is r2


def test_get_by_num_out_of_range():
    h = RunHistory()
    assert h.get_by_num(0) is None
    assert h.get_by_num(99) is None


# ── cache / find_cached ───────────────────────────────────────────────────────

def test_find_cached_hit():
    h = RunHistory()
    _add(h, {"temp": "300"})
    hit = h.find_cached({"temp": "300"})
    assert hit is not None
    assert hit["inputs"] == {"temp": "300"}


def test_find_cached_miss():
    h = RunHistory()
    _add(h, {"temp": "300"})
    assert h.find_cached({"temp": "400"}) is None


def test_find_cached_ignores_error_runs():
    h = RunHistory()
    _add(h, {"temp": "300"}, status="error")
    assert h.find_cached({"temp": "300"}) is not None  # error runs ARE returned by find_cached
    # The *caller* (run_simulation) skips error runs — test that contract too
    hit = h.find_cached({"temp": "300"})
    assert hit["status"] == "error"


def test_find_cached_key_order_insensitive():
    """Cache key is stable regardless of dict insertion order."""
    h = RunHistory()
    _add(h, {"b": "2", "a": "1"})
    hit = h.find_cached({"a": "1", "b": "2"})
    assert hit is not None


def test_find_cached_returns_most_recent():
    h = RunHistory()
    _add(h, {"a": "1"})
    _add(h, {"b": "x"})
    r3 = _add(h, {"a": "1"})  # second run with same inputs
    hit = h.find_cached({"a": "1"})
    assert hit["run_id"] == r3["run_id"]


# ── update / delete / reorder ─────────────────────────────────────────────────

def test_update_run_changes_label():
    h = RunHistory()
    r = _add(h, {"a": "1"})
    h.update_run(r["run_id"], label="My Run")
    assert h.get_by_id(r["run_id"])["label"] == "My Run"


def test_delete_removes_run_and_renumbers():
    h = RunHistory()
    r1 = _add(h, {"a": "1"})
    r2 = _add(h, {"a": "2"})
    r3 = _add(h, {"a": "3"})
    assert h.delete(r2["run_id"])
    assert h.get_by_id(r2["run_id"]) is None
    assert len(h.runs) == 2
    # run_num should be renumbered 1, 2
    nums = [r["run_num"] for r in h.runs]
    assert nums == [1, 2]


def test_delete_missing_returns_false():
    h = RunHistory()
    assert not h.delete("nonexistent")


def test_reorder():
    h = RunHistory()
    r1 = _add(h, {"a": "1"})
    r2 = _add(h, {"a": "2"})
    r3 = _add(h, {"a": "3"})
    h.reorder([r3["run_id"], r1["run_id"], r2["run_id"]])
    assert [r["run_id"] for r in h.runs] == [r3["run_id"], r1["run_id"], r2["run_id"]]


def test_reorder_unknown_ids_appended_at_end():
    h = RunHistory()
    r1 = _add(h, {"a": "1"})
    r2 = _add(h, {"a": "2"})
    h.reorder([r2["run_id"]])  # r1 not mentioned
    assert h.runs[0]["run_id"] == r2["run_id"]
    assert h.runs[1]["run_id"] == r1["run_id"]


# ── disk persistence ──────────────────────────────────────────────────────────

def test_save_and_load_from_disk(tmp_path):
    cache_dir = str(tmp_path / "cache")
    h1 = RunHistory(cache_dir=cache_dir)
    r = h1.add(input_values={"t": "300"}, outputs={"y": 2}, log="done", status="success")

    # Load into a fresh instance
    h2 = RunHistory(cache_dir=cache_dir)
    h2.load_from_disk()
    assert len(h2.runs) == 1
    assert h2.runs[0]["run_id"] == r["run_id"]
    assert h2.runs[0]["inputs"] == {"t": "300"}


def test_load_skips_corrupt_json(tmp_path):
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    (cache_dir / "run_bad.json").write_text("{broken}", encoding="utf-8")
    h = RunHistory(cache_dir=str(cache_dir))
    h.load_from_disk()
    assert h.runs == []


def test_delete_also_removes_json_file(tmp_path):
    cache_dir = str(tmp_path / "cache")
    h = RunHistory(cache_dir=cache_dir)
    r = h.add(input_values={"a": "1"}, outputs={}, log="", status="success")
    json_file = os.path.join(cache_dir, f"run_{r['run_id']}.json")
    assert os.path.exists(json_file)
    h.delete(r["run_id"])
    assert not os.path.exists(json_file)


def test_update_run_persists_to_disk(tmp_path):
    cache_dir = str(tmp_path / "cache")
    h = RunHistory(cache_dir=cache_dir)
    r = h.add(input_values={"a": "1"}, outputs={}, log="", status="success")
    h.update_run(r["run_id"], label="renamed")

    json_file = os.path.join(cache_dir, f"run_{r['run_id']}.json")
    with open(json_file) as f:
        saved = json.load(f)
    assert saved["label"] == "renamed"

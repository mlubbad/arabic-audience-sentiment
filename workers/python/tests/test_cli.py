import json

from collectors.cli import main


def run(tmp_path, argv, monkeypatch):
    monkeypatch.setattr("sys.argv", ["collect", "--source", "fixture", "--workspace", "w",
                                     "--video", "abcdefghijk", "--output", str(tmp_path)] if argv is None else argv)
    return main()


def test_fixture_run_writes_manifest_and_is_idempotent_on_rerun(tmp_path, monkeypatch):
    argv = ["collect", "--source", "fixture", "--workspace", "w",
            "--video", "abcdefghijk", "--output", str(tmp_path)]
    assert run(tmp_path, argv, monkeypatch) == 0
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["status"] == "succeeded"
    assert manifest["unique_comments_in_workspace"] == 2
    assert manifest["source"] == "sanitized_fixture"
    # Coverage must be described as source traversal, never as a guaranteed total.
    assert "not established" in manifest["coverage"]

    # A completed job is not re-claimed, so a second run cannot duplicate rows.
    assert run(tmp_path, argv, monkeypatch) == 0
    assert json.loads((tmp_path / "manifest.json").read_text())["unique_comments_in_workspace"] == 2


def test_api_source_without_a_key_fails_instead_of_reporting_empty_success(tmp_path, monkeypatch):
    monkeypatch.delenv("YOUTUBE_API_KEY", raising=False)
    argv = ["collect", "--source", "youtube-api", "--workspace", "w",
            "--video", "abcdefghijk", "--output", str(tmp_path)]
    monkeypatch.setattr("sys.argv", argv)
    try:
        main()
    except ValueError as exc:
        assert "missing_api_key" in str(exc)
    else:
        raise AssertionError("a missing key must not produce a successful empty run")
    assert not (tmp_path / "manifest.json").exists()

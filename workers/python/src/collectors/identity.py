def stable_author_id(value: object) -> str | None:
    """Keep unknown authors null because a shared placeholder merges strangers into one commenter."""
    if value is None:
        return None
    normalized = str(value).strip()
    if normalized in {"", "None", "null"}:
        return None
    return normalized

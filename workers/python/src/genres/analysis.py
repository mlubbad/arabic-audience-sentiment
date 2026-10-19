from .protocol import GenreClassifier, GenreError, GenreItem


def classify(
    classifier: GenreClassifier,
    taxonomy: list[dict],
    classification_key: str,
    taxonomy_version: int,
    rows: list[dict],
) -> list[dict]:
    items = [
        GenreItem(
            index=i,
            title=str(row.get("title") or ""),
            description=str(row.get("description") or ""),
            tags=[str(tag) for tag in row.get("tags") or []],
            category_id=row.get("category_id"),
            duration_sec=row.get("duration_sec"),
        )
        for i, row in enumerate(rows)
    ]
    verdicts = classifier.classify(taxonomy, items)
    if len(verdicts) != len(rows):
        raise GenreError("classification_length_mismatch")
    keys = {item["key"] for item in taxonomy}
    records = []
    for row, verdict in zip(rows, verdicts, strict=True):
        if verdict.status == "succeeded" and verdict.genre_key not in keys:
            status, genre_key, confidence, error = "failed", None, None, "gemini_bad_response"
        else:
            status, genre_key = verdict.status, verdict.genre_key
            confidence, error = verdict.confidence, verdict.error_code
        records.append({
            "external_video_id": row["external_video_id"],
            "classification_key": classification_key,
            "taxonomy_version": taxonomy_version,
            "status": status,
            "genre_key": genre_key,
            "confidence": confidence,
            "model_id": classifier.model_id,
            "prompt_version": classifier.prompt_version,
            "error_code": error,
        })
    return records

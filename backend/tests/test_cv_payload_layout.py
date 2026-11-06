from types import SimpleNamespace

from app.providers.vectorstore.qdrant import CV_CONTENT_KEYS, QdrantUtils


class _Client:
    def __init__(self):
        self.points = []

    def upsert(self, collection_name, points):
        self.points.extend(points)


def _store(record):
    qd = QdrantUtils.__new__(QdrantUtils)
    qd._client = _Client()
    assert qd.store_structured_data("cv1", "cv", record)
    return qd._client.points[0].payload


def test_cv_content_is_stored_once_inside_structured_info():
    record = {"name": "A B", "job_title": "Dev", "category": "Software", "gender": "Male", "languages": ["English"], "certifications": ["Project Management Professional (PMP)"],
              "skills_sentences": ["python"], "responsibility_sentences": ["build"], "keywords": ["py"],
              "contact_info": {"name": "A B"}, "processing_metadata": {"x": 1}, "doc_type": "resume",
              "email": "a@b.com", "phone": "+97150", "location": "Dubai, UAE", "years_of_experience": 7,
              "is_job_application": True, "job_id": "j1", "applicant_name": "A B"}
    payload = _store(record)
    for key in CV_CONTENT_KEYS:
        assert key not in payload, key                       # not duplicated at the top level
        assert payload["structured_info"][key] == record[key]  # ...but all there, where every reader looks
    # the facts about the person and the application stay at the top level, where the filters and indexes are
    for key in ("email", "phone", "location", "years_of_experience", "is_job_application", "job_id", "applicant_name"):
        assert payload[key] == record[key]
    assert payload["id"] == "cv1" and "uploaded_at" in payload


def test_a_job_description_keeps_its_explicit_structured_info():
    qd = QdrantUtils.__new__(QdrantUtils)
    qd._client = _Client()
    qd.store_structured_data("jd1", "jd", {"structured_info": {"job_title": "X", "skills_sentences": ["a"]}})
    assert qd._client.points[0].payload["structured_info"]["job_title"] == "X"

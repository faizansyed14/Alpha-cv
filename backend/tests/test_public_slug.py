from app.services.careers_helpers import generate_public_slug, is_public_slug, slugify


def test_slug_has_title_code_and_random_tail():
    s = generate_public_slug("Asset Coordinator", "AC-2026-001")
    assert s.startswith("asset-coordinator-ac-2026-001-")
    tail = s.rsplit("-", 1)[1]
    assert len(tail) == 6 and tail.isalnum() and tail == tail.lower()
    assert is_public_slug(s)


def test_two_links_for_the_same_job_differ_and_cannot_be_derived():
    a, b = generate_public_slug("Asset Coordinator", "AC-2026-001"), generate_public_slug("Asset Coordinator", "AC-2026-001")
    assert a != b


def test_awkward_titles_are_cleaned():
    assert slugify("Senior C++ / .NET Dev (Dubai) – UAE!") == "senior-c-net-dev-dubai-uae"
    assert slugify("مدير المشاريع") == ""
    assert generate_public_slug("مدير", None).startswith("job-")
    assert len(generate_public_slug("x" * 200, "AC-2026-001")) <= 90


def test_old_random_tokens_are_not_slugs():
    assert not is_public_slug("Vpt6lzQigOypAdyTiuSxxZSyFJHvxDlGvjWAr7KVjRk")
    assert not is_public_slug("abc_def")
    assert not is_public_slug(None) and not is_public_slug("")

"""The hiring picture: a real JPEG of the right size, drawn from the role, without any model call."""
import io
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from app.api.deps import require_core_app
from app.api.routers import careers as C
from app.services import hiring_image as H


def decode(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data))


def test_it_is_a_1080_square_jpeg():
    im = decode(H.render("Senior Network & Security Engineer", "Sharjah, UAE"))
    assert im.format == "JPEG" and im.size == (1080, 1080)


def test_the_role_and_city_go_on_one_line_and_the_city_is_not_repeated():
    assert H.role_line("Network Engineer", "Sharjah, UAE") == "Network Engineer - Sharjah"
    assert H.role_line("Network Engineer - Sharjah", "Sharjah") == "Network Engineer - Sharjah"
    assert H.role_line("Accountant", "") == "Accountant"
    assert H.role_line("   ", "") == "New Opportunity"


def test_characters_the_fonts_cannot_draw_are_dropped_instead_of_printing_boxes():
    assert H.role_line("مهندس شبكات", "") == "New Opportunity"
    assert H.role_line("Engineer مهندس", "") == "Engineer"
    assert H.role_line("Café Manager\n\t(Dubai)", "") == "Café Manager (Dubai)"


def test_different_roles_give_different_pictures_and_the_same_role_the_same_one():
    a, b = H.hiring_image("Data Analyst", "Dubai"), H.hiring_image("Cloud Architect", "Dubai")
    assert a != b and a == H.hiring_image("Data Analyst", "Dubai")


def test_a_very_long_title_still_fits_inside_the_picture():
    im = decode(H.render("Chief " + "Executive " * 30, "Dubai")).convert("L")
    right_edge = im.crop((1075, 400, 1080, 900))                  # nothing may run off the right side
    assert min(right_edge.getdata()) > 200


def test_file_names_are_safe():
    assert H.file_name("Sr. Network & Security Engineer!") == "hiring-sr-network-security-engineer.jpg"
    assert H.file_name("مهندس") == "hiring-job.jpg"
    assert "/" not in H.file_name("../../etc/passwd") and ".." not in H.file_name("../../etc/passwd")


@pytest.fixture
def client(monkeypatch):
    store = SimpleNamespace(get_job_posting_by_id=lambda i: {"job_title": "Finance Manager", "job_location": "Dubai, UAE"} if i == "job-1" else None)
    monkeypatch.setattr(C, "get_store", lambda: store)
    app = FastAPI()
    app.include_router(C.router, prefix="/api/careers")
    app.dependency_overrides[require_core_app] = lambda: SimpleNamespace(username="rita", role="user")
    return TestClient(app)


def test_the_endpoint_returns_the_picture_and_can_send_it_as_a_download(client):
    r = client.get("/api/careers/admin/jobs/job-1/hiring-image")
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg" and decode(r.content).size == (1080, 1080)
    assert r.headers["content-disposition"].startswith("inline") and "hiring-finance-manager.jpg" in r.headers["content-disposition"]
    d = client.get("/api/careers/admin/jobs/job-1/hiring-image?download=true")
    assert d.headers["content-disposition"].startswith("attachment")


def test_an_unknown_job_is_a_404(client):
    assert client.get("/api/careers/admin/jobs/nope/hiring-image").status_code == 404

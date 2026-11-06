"""LinkedIn and GitHub links read from a CV, stored with the other contact facts, and returned only as clean https links."""
import fitz
import pytest

from app.ingestion.contact import extract_contacts
from app.ingestion.cv_parser import ParsingService
from app.ingestion.profile_links import find_profile_links, normalize_github, normalize_linkedin
from app.providers.vectorstore.qdrant import resolve_candidate_contact

CV = """Ahmed Khan
Senior Network Engineer
Email: ahmed.khan@example.com | Mobile: +971 50 123 4567
LinkedIn: https://www.linkedin.com/in/ahmed-khan-8a2b/ | GitHub: github.com/ahmedk
Experience: ten years of network engineering across Dubai and Abu Dhabi.
"""


def test_both_links_are_found_and_rebuilt_as_plain_https_links():
    links = find_profile_links(CV)
    assert links["linkedin"] == ["https://www.linkedin.com/in/ahmed-khan-8a2b"]
    assert links["github"] == ["https://github.com/ahmedk"]


def test_the_link_forms_people_actually_write():
    text = "see linkedin.com/in/jane-doe, or http://ae.linkedin.com/in/jane-doe?trk=x and www.github.com/jane-doe/my-repo."
    links = find_profile_links(text)
    assert links["linkedin"] == ["https://www.linkedin.com/in/jane-doe"]          # the same person written twice counts once
    assert links["github"] == ["https://github.com/jane-doe"]                      # a repository link is reduced to the account


@pytest.mark.parametrize("text", [
    "linkedin.com/company/acme-corp",                  # a company page is not the candidate
    "https://github.com/features/copilot",             # GitHub's own pages are not accounts
    "https://github.com/orgs/acme/people",
    "write to jane@github.com or jane@linkedin.com",   # e-mail addresses
    "notlinkedin.com/in/someone and fakegithub.com/someone",   # look-alike hosts
    "javascript:alert(1)//linkedin.com",
])
def test_things_that_are_not_a_candidates_profile_are_ignored(text):
    assert find_profile_links(text) == {"linkedin": [], "github": []}


def test_stored_values_are_cleaned_before_they_can_become_a_clickable_link():
    assert normalize_linkedin("javascript:alert(1)") is None
    assert normalize_linkedin("https://evil.example/linkedin.com/in/x") is None
    assert normalize_linkedin("linkedin.com/in/jane-doe") == "https://www.linkedin.com/in/jane-doe"
    assert normalize_github("https://evil.example/") is None
    assert normalize_github("github.com/jane-doe") == "https://github.com/jane-doe"
    assert normalize_github(None) is None


def test_extract_contacts_returns_the_links_next_to_email_and_phone():
    found = extract_contacts(CV)
    assert found["emails"] == ["ahmed.khan@example.com"]
    assert found["phones"] and found["linkedin"] and found["github"]


def test_email_phone_and_links_are_all_kept_out_of_the_text_sent_to_the_model():
    clean, pii = ParsingService().remove_pii_data(CV)
    for private in ("ahmed.khan@example.com", "50 123 4567", "linkedin.com", "ahmed-khan-8a2b", "github.com", "ahmedk"):
        assert private not in clean
    assert "[EMAIL]" in clean and "[PHONE]" in clean and "[LINKEDIN]" in clean and "[GITHUB]" in clean
    assert "Senior Network Engineer" in clean and "ten years of network engineering" in clean      # the rest of the CV is untouched
    assert pii["linkedin"] == ["https://www.linkedin.com/in/ahmed-khan-8a2b"]                      # ...but they are still captured
    assert pii["github"] == ["https://github.com/ahmedk"]
    assert pii["email"] == ["ahmed.khan@example.com"]


def test_a_repository_path_after_the_account_is_blanked_out_with_it():
    clean, pii = ParsingService().remove_pii_data("Code: https://github.com/ahmedk/network-tools/tree/main, and more text follows here.")
    assert "network-tools" not in clean and "[GITHUB]" in clean and "and more text follows here." in clean
    assert pii["github"] == ["https://github.com/ahmedk"]


def _pdf_with_clickable_words(path):
    """A CV whose page only says the words LinkedIn and GitHub: the addresses are attached to them as links."""
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 90), "Ahmed Khan - Senior Network Engineer with ten years of experience in Dubai.", fontsize=11)
    page.insert_text((72, 120), "Email: ahmed.khan@example.com   Mobile: +971 50 123 4567", fontsize=11)
    page.insert_text((72, 150), "LinkedIn", fontsize=11)
    page.insert_text((150, 150), "GitHub", fontsize=11)
    page.insert_link({"kind": fitz.LINK_URI, "from": fitz.Rect(72, 138, 120, 156), "uri": "https://www.linkedin.com/in/ahmed-khan-8a2b"})
    page.insert_link({"kind": fitz.LINK_URI, "from": fitz.Rect(150, 138, 190, 156), "uri": "https://github.com/ahmedk"})
    doc.save(str(path))
    doc.close()


def test_a_link_hidden_behind_the_word_linkedin_in_a_pdf_is_found(tmp_path):
    path = tmp_path / "cv.pdf"
    _pdf_with_clickable_words(path)
    result = ParsingService().process_document(str(path), "cv")
    assert "linkedin.com" not in result["raw_text"].lower()                       # the page text really has no address
    assert result["extracted_pii"]["linkedin"] == ["https://www.linkedin.com/in/ahmed-khan-8a2b"]
    assert result["extracted_pii"]["github"] == ["https://github.com/ahmedk"]
    assert "linkedin.com" not in result["clean_text"].lower() and "github.com" not in result["clean_text"].lower()


def test_a_word_file_with_clickable_links_is_read_too(tmp_path):
    import docx
    from docx.opc.constants import RELATIONSHIP_TYPE as RT

    document = docx.Document()
    document.add_paragraph("Ahmed Khan - Senior Network Engineer with ten years of experience in Dubai and Abu Dhabi.")
    paragraph = document.add_paragraph("Profiles: ")
    rid = document.part.relate_to("https://www.linkedin.com/in/ahmed-khan-8a2b", RT.HYPERLINK, is_external=True)
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    link = OxmlElement("w:hyperlink")
    link.set(qn("r:id"), rid)
    run = OxmlElement("w:r")
    text = OxmlElement("w:t")
    text.text = "LinkedIn"
    run.append(text)
    link.append(run)
    paragraph._p.append(link)
    path = tmp_path / "cv.docx"
    document.save(str(path))
    result = ParsingService().process_document(str(path), "cv")
    assert result["extracted_pii"]["linkedin"] == ["https://www.linkedin.com/in/ahmed-khan-8a2b"]


def test_a_file_whose_links_cannot_be_read_still_parses(tmp_path):
    path = tmp_path / "cv.txt"
    path.write_text(CV, encoding="utf-8")
    assert ParsingService().extract_hyperlinks(str(path), ".txt") == ""
    assert ParsingService().extract_hyperlinks(str(tmp_path / "missing.pdf"), ".pdf") == ""
    assert ParsingService().process_document(str(path), "cv")["extracted_pii"]["github"] == ["https://github.com/ahmedk"]


def test_the_candidates_links_are_returned_from_wherever_they_were_stored():
    payload = {"linkedin_url": "linkedin.com/in/jane-doe"}
    structured = {"contact_info": {"github": "https://github.com/jane-doe"}}
    found = resolve_candidate_contact(payload, structured)
    assert found["linkedin_url"] == "https://www.linkedin.com/in/jane-doe"
    assert found["github_url"] == "https://github.com/jane-doe"
    bad = resolve_candidate_contact({"linkedin_url": "javascript:alert(1)"}, {"github_url": "https://evil.example/x"})
    assert bad["linkedin_url"] is None and bad["github_url"] is None
    assert resolve_candidate_contact({}, {})["linkedin_url"] is None


def test_the_links_are_stored_as_facts_about_the_candidate():
    from types import SimpleNamespace

    from app.ingestion.pipeline import CANDIDATE_FIELDS, _build_record, _candidate_facts

    assert "linkedin_url" in CANDIDATE_FIELDS and "github_url" in CANDIDATE_FIELDS     # kept when a second source joins the record
    sub = SimpleNamespace(hints={}, candidate={}, source="upload", filename="cv.pdf", job=None)
    pii = {"email": ["a@example.com"], "phone": [], "linkedin": ["https://www.linkedin.com/in/jane-doe"], "github": []}
    facts = _candidate_facts(sub, {"name": "Jane Doe"}, pii)
    assert facts["linkedin_url"] == "https://www.linkedin.com/in/jane-doe" and "github_url" not in facts
    record = _build_record(sub, {"name": "Jane Doe"}, pii, None)
    assert record["linkedin_url"] == "https://www.linkedin.com/in/jane-doe"

"""LinkedIn and GitHub links read from a CV, stored with the other contact facts, and returned only as clean https links."""
import fitz
import pytest

from app.ingestion.contact import extract_contacts
from app.ingestion.cv_parser import ParsingService
from app.ingestion.profile_links import find_profile_links, normalize_github, normalize_linkedin

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


def test_the_links_are_stored_as_facts_about_the_candidate():
    from types import SimpleNamespace

    from app.ingestion.pipeline import CANDIDATE_FIELDS, _candidate_facts, _person
    from app.store import get_store

    assert "linkedin_url" in CANDIDATE_FIELDS and "github_url" in CANDIDATE_FIELDS     # kept when a second source joins the record
    sub = SimpleNamespace(hints={}, candidate={}, source="upload", filename="cv.pdf", job=None)
    pii = {"email": ["a@example.com"], "phone": [], "linkedin": ["https://www.linkedin.com/in/jane-doe"], "github": []}
    facts = _candidate_facts(sub, {"name": "Jane Doe"}, pii)
    assert facts["linkedin_url"] == "https://www.linkedin.com/in/jane-doe" and "github_url" not in facts
    person = _person(sub, {"name": "Jane Doe"}, pii)
    assert person["linkedin_url"] == "https://www.linkedin.com/in/jane-doe" and person["full_name"] == "Jane Doe"

    store = get_store()                                                              # ...and they are columns of the candidate
    cid = store.save_candidate({"id": "00000000-0000-0000-0000-000000000001", "content_sha256": "a" * 64, "filename": "cv.pdf",
                                "facts": {**person, "github_url": "https://github.com/jane-doe"}})
    detail = store.candidate_detail(cid)
    assert detail["linkedin_url"] == "https://www.linkedin.com/in/jane-doe" and detail["github_url"] == "https://github.com/jane-doe"


# ---------------------------------------------------------------------------------------------------------------------
# false positives: what looks like a profile link but is not the candidate's
# ---------------------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("text", [
    "LinkedIn: linkedin.com/in/yourname",                         # the template words nobody replaced
    "linkedin.com/in/your-profile and linkedin.com/in/firstname-lastname",
    "linkedin.com/in/username | linkedin.com/in/full-name",
    "GitHub: github.com/yourusername and github.com/your-username",
    "github.com/username",
    "linkedin.com/in/me",                                         # too short to be a LinkedIn address
    "https://www.google.com/url?q=https://www.linkedin.com/in/someone-else&sa=D",         # a link inside another address
    "https://web.archive.org/web/2020/https://www.linkedin.com/in/archived-person",
    "https://l.facebook.com/l.php?u=https://github.com/somebody",
])
def test_templates_and_links_inside_other_addresses_are_not_profiles(text):
    assert find_profile_links(text) == {"linkedin": [], "github": []}


def test_a_real_profile_after_a_label_or_bracket_is_still_found():
    text = "Profiles: (linkedin.com/in/omar-sedeek) [github.com/omarsedeek] <https://www.linkedin.com/in/omar-sedeek-9a1b2>"
    links = find_profile_links(text)
    assert links["linkedin"] == ["https://www.linkedin.com/in/omar-sedeek", "https://www.linkedin.com/in/omar-sedeek-9a1b2"]
    assert links["github"] == ["https://github.com/omarsedeek"]


def test_the_candidate_is_chosen_among_several_linkedin_profiles_by_their_name_not_by_position():
    from app.ingestion.profile_links import pick_linkedin

    links = ["https://www.linkedin.com/in/sara-ali-123", "https://www.linkedin.com/in/omar-sedeek"]      # a recommender is written first
    assert pick_linkedin(links, "Omar Sedeek", "omar.s@example.com") == "https://www.linkedin.com/in/omar-sedeek"
    assert pick_linkedin(links, None, "omarsedeek@example.com") == "https://www.linkedin.com/in/omar-sedeek"       # the e-mail will do
    assert pick_linkedin(links, "Someone Else") == links[0]                                      # nothing resembles them: the first written
    assert pick_linkedin(links[:1], "Omar Sedeek") == links[0]                                   # one link is taken as theirs
    assert pick_linkedin([], "Omar Sedeek") is None


def test_a_github_account_that_is_only_a_repository_of_someone_else_is_not_the_candidate():
    from app.ingestion.profile_links import github_repo_only, pick_github

    text = "Tools: Flask (github.com/pallets/flask), React (https://github.com/facebook/react)"
    links = find_profile_links(text)
    only = github_repo_only(text)
    assert links["github"] == ["https://github.com/pallets", "https://github.com/facebook"] and only == links["github"]
    assert pick_github(links["github"], only, "Omar Sedeek") is None                              # two tools, no candidate

    own = "GitHub: github.com/omarsedeek ; forked github.com/facebook/react"
    links, only = find_profile_links(own), github_repo_only(own)
    assert only == ["https://github.com/facebook"]
    assert pick_github(links["github"], only, "Omar Sedeek") == "https://github.com/omarsedeek"

    mine = "Projects: github.com/oreaba/mlops-platform"                                          # their own repository: the name matches
    links, only = find_profile_links(mine), github_repo_only(mine)
    assert pick_github(links["github"], only, "Mohammad Oreaba") == "https://github.com/oreaba"
    assert pick_github(links["github"], only, "Someone Else") is None                              # a repository of somebody not them

    bare = "see github.com/coolcoder99"                                                           # a plain account link is taken as theirs
    links, only = find_profile_links(bare), github_repo_only(bare)
    assert pick_github(links["github"], only, "Someone Else") == "https://github.com/coolcoder99"


def test_the_repo_only_accounts_are_reported_with_the_contacts():
    found = extract_contacts("GitHub: github.com/omarsedeek  tools: github.com/pallets/flask")
    assert found["github"] == ["https://github.com/omarsedeek", "https://github.com/pallets"]
    assert found["github_repo_only"] == ["https://github.com/pallets"]

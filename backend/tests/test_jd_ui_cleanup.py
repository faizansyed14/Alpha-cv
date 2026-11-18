"""The careers page shows what the JD says, never the model's notes about it; and Word JDs are read whole (form fields, merged cells)."""
import io

import docx
from docx.oxml import parse_xml

from app.ingestion.cv_parser import docx_lines
from app.providers.llm.service import clean_ui_fields

RESPONSIBILITIES = ("• Design and implement the Technology Resilience Program activities.\n"
                    "• Able to take full responsibility for the planning, coordination, and execution of assigned tasks.")


def test_the_lines_from_production_are_removed():
    ui = {"job_title": "Technology Resilience Senior Analyst", "job_location": "Dubai", "key_responsibilities": RESPONSIBILITIES,
          "job_summary": "Our client needs a resilience SME. No other details are specified in the source text.",
          "qualifications": ("• Able to take full responsibility for the planning, coordination, and execution of assigned tasks.\n"
                             "• No other qualifications, certifications, or experience requirements are specified in the source text.")}
    out = clean_ui_fields(ui)
    assert out["qualifications"] == ""                                    # both lines were noise: the page leaves the section out
    assert out["key_responsibilities"] == RESPONSIBILITIES                # real duties stay
    assert out["job_summary"] == "Our client needs a resilience SME."


def test_real_qualifications_are_kept_even_with_words_like_required():
    quals = ("• Bachelor's degree in Technology or a related field\n"
             "• ISO 22301 and Disaster Recovery certifications required\n"
             "• 7-10 years of experience, 5-7 in technology resilience\n"
             "• No prior aviation experience needed, but project management is preferred")
    out = clean_ui_fields({"qualifications": quals, "key_responsibilities": RESPONSIBILITIES, "job_summary": "A resilience role."})
    assert out["qualifications"] == quals


def test_notes_in_other_shapes_are_removed():
    for note in ("• Not specified", "• N/A", "• Additional qualifications: not mentioned", "• The job description does not list certifications.",
                 "• None stated", "• No specific experience requirements are listed"):
        assert clean_ui_fields({"qualifications": note, "key_responsibilities": "", "job_summary": ""})["qualifications"] == "", note


def _doc_with_form_field_and_merged_cells() -> docx.Document:
    d = docx.Document()
    d.add_paragraph("A: Job Information")
    # a content control (a template's fill-in field): python-docx's .paragraphs never sees it
    d.element.body.append(parse_xml(
        '<w:sdt xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:sdtContent>'
        '<w:p><w:r><w:t>ISO 22301 certified</w:t></w:r></w:p></w:sdtContent></w:sdt>'))
    t = d.add_table(rows=2, cols=4)
    merged = t.cell(0, 0).merge(t.cell(0, 3))                               # one cell across 4 columns
    merged.text = "The purpose of this role is to provide a technology resilience management SME service across the program."
    t.cell(1, 0).text, t.cell(1, 1).text = "Skills", "GRC tools"
    buf = io.BytesIO()
    d.save(buf)
    return docx.Document(io.BytesIO(buf.getvalue()))


def test_word_form_fields_are_read_and_merged_cells_are_read_once():
    lines = docx_lines(_doc_with_form_field_and_merged_cells())
    assert "ISO 22301 certified" in lines
    assert sum("technology resilience management SME" in line for line in lines) == 1
    assert "Skills" in lines and "GRC tools" in lines


def test_a_short_heading_may_repeat_but_a_long_paragraph_is_kept_once():
    d = docx.Document()
    for _ in range(2):
        d.add_paragraph("Responsibilities")
        d.add_paragraph("x")
    long = "Responsible for the annual training and testing calendar of every technology resilience exercise."
    d.add_paragraph(long)
    d.add_paragraph("y")
    d.add_paragraph(long)
    lines = docx_lines(d)
    assert lines.count("Responsibilities") == 2 and lines.count(long) == 1

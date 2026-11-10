"""
Parsing Service - Consolidated Document Processing
Handles ALL text extraction from various file formats with PII removal.
Single responsibility: Extract clean text from documents.
"""
import html as html_lib
import logging
import os
import re
import subprocess
import zipfile
from html.parser import HTMLParser
from typing import Dict, Any, Optional, Tuple
from pathlib import Path

# Document processing libraries
import fitz  # PyMuPDF for PDF
import docx  # python-docx for DOCX
from PIL import Image

from app.config.settings import settings
from app.ingestion.ocr import ocr_image, ocr_png
from app.ingestion.contact import extract_contacts



logger = logging.getLogger(__name__)

class ParsingService:
    """
    Consolidated service for all document text extraction and processing.
    Combines PDF, DOCX, OCR, and PII removal into a single clean interface.
    """
    
    # Supported file extensions
    SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.doc', '.rtf', '.odt', '.html', '.htm', '.txt',
                            '.png', '.jpg', '.jpeg', '.tiff', '.bmp']
    MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
    
    def __init__(self):
        """Initialize the parsing service."""
        self.logger = logger
        self.logger.info("ParsingService initialized")
    
    def process_document(self, file_path: str, doc_type: str = "auto") -> Dict[str, Any]:
        """
        Main processing function - calls appropriate extraction method.
        
        Args:
            file_path: Path to the document file
            doc_type: Type of document ("cv", "jd", or "auto" for detection)
            
        Returns:
            Dict containing extracted text and metadata
        """
        try:
            # Validate file
            if not os.path.exists(file_path):
                raise FileNotFoundError(f"File not found: {file_path}")
            
            file_size = os.path.getsize(file_path)
            if file_size > self.MAX_FILE_SIZE:
                raise ValueError(f"File too large: {file_size} bytes (max: {self.MAX_FILE_SIZE})")
            
            file_ext = Path(file_path).suffix.lower()
            if file_ext not in self.SUPPORTED_EXTENSIONS:
                raise ValueError(f"Unsupported file extension: {file_ext}")
            
            self.logger.info(f"Processing document: {file_path} ({file_size:,} bytes)")
            
            # Extract text based on file type
            ocr_used = False
            if file_ext == '.pdf':
                raw_text, ocr_used = self.extract_text_from_pdf(file_path)
            elif file_ext in ['.docx', '.doc']:
                raw_text = self.extract_text_from_word(file_path)
                ocr_used = False
            elif file_ext == '.rtf':
                raw_text = self.extract_text_from_rtf(file_path)
                ocr_used = False
            elif file_ext == '.odt':
                raw_text = self.extract_text_from_odt(file_path)
                ocr_used = False
            elif file_ext in ['.html', '.htm']:
                raw_text = self.extract_text_from_html(file_path)
                ocr_used = False
            elif file_ext in ['.png', '.jpg', '.jpeg', '.tiff', '.bmp']:
                raw_text = self.extract_with_ocr(file_path)
                ocr_used = True
            elif file_ext == '.txt':
                raw_text = self._extract_text_from_txt(file_path)
                ocr_used = False
            else:
                raise ValueError(f"No extraction method for: {file_ext}")
            
            # Clean and validate extracted text
            if not raw_text or len(raw_text.strip()) < 50:
                raise ValueError(f"Insufficient text extracted: {len(raw_text)} characters")
            
            # Remove PII data (the links behind clickable words are read from the original file too)
            clean_text, extracted_pii = self.remove_pii_data(raw_text, self.extract_hyperlinks(file_path, file_ext))
            
            result = {
        "raw_text": raw_text,
        "clean_text": clean_text,
        "extracted_pii": extracted_pii,  # New field
        "file_path": file_path,
        "file_size": file_size,
        "file_extension": file_ext,
        "character_count": len(clean_text),
        "processing_status": "success",
        "ocr_used": ocr_used  # Track if OCR was used
    }

            self.logger.info(f"Document processed successfully: {len(clean_text):,} characters")
            return result
            
        except Exception as e:
            self.logger.error(f"Document processing failed: {str(e)}")
            raise Exception(f"Document processing failed: {str(e)}")
    
    def extract_text_from_pdf(self, file_path: str) -> Tuple[str, bool]:
        """
        Extract text from PDF files using PyMuPDF.
        Combines all PDF extraction logic into one optimized function.
        """
        try:
            self.logger.info(f"Extracting text from PDF: {file_path}")
            
            doc = fitz.open(file_path)
            text_parts = []
            ocr_used = False
            ocr_pages = 0
            
            for page_num in range(len(doc)):
                page = doc.load_page(page_num)
                page_text = page.get_text()

                if page_text.strip():  # Only add pages with content
                    text_parts.append(page_text)

                if len(page_text.strip()) >= 100:
                    continue  # plenty of real text already, this page needs no OCR

                # Sparse/empty text layer: this page is almost certainly a scan.
                if ocr_pages >= settings.OCR_MAX_PAGES:
                    self.logger.info(f"OCR page cap ({settings.OCR_MAX_PAGES}) reached; skipping page {page_num + 1}")
                    continue
                ocr_used = True
                ocr_pages += 1
                self.logger.info(f"OCR needed for page {page_num + 1} (sparse text: {len(page_text.strip())} chars)")
                ocr_text = ""
                try:
                    # Prefer OCR-ing the embedded raster image(s) directly, usually sharper than re-rasterizing
                    # the page. Tiny images (logos, icons, bullets) are skipped. CMYK images are converted to RGB.
                    for img in page.get_images():
                        if min(img[2], img[3]) < settings.OCR_MIN_IMAGE_PX:
                            continue
                        pix = fitz.Pixmap(doc, img[0])
                        if pix.n - pix.alpha >= 4:
                            pix = fitz.Pixmap(fitz.csRGB, pix)
                        ocr_text += self._perform_ocr_on_bytes(pix.tobytes("png")) + "\n"
                        pix = None
                except Exception as ocr_error:
                    self.logger.warning(f"Embedded-image OCR failed for page {page_num + 1}: {str(ocr_error)}")

                if len(ocr_text.strip()) < 20:
                    # No usable embedded image: rasterize the page as displayed so any scan gets a real attempt,
                    # however the PDF encodes it internally.
                    try:
                        page_pixmap = page.get_pixmap(dpi=200)
                        ocr_text = self._perform_ocr_on_bytes(page_pixmap.tobytes("png"))
                    except Exception as page_ocr_error:
                        self.logger.warning(f"Full-page OCR fallback failed for page {page_num + 1}: {str(page_ocr_error)}")

                if ocr_text.strip():
                    text_parts.append(f"\n[OCR from page {page_num + 1}]: {ocr_text}")
            
            doc.close()
            
            extracted_text = "\n".join(text_parts).strip()
            
            if not extracted_text:
                raise ValueError("No text could be extracted from PDF")
            
            if ocr_used:
                self.logger.info(f"PDF extraction successful with OCR: {len(extracted_text):,} characters")
            else:
                self.logger.info(f"PDF extraction successful: {len(extracted_text):,} characters")
            return extracted_text, ocr_used
            
        except Exception as e:
            self.logger.error(f"PDF extraction failed: {str(e)}")
            raise Exception(f"PDF extraction failed: {str(e)}")
    
    def extract_hyperlinks(self, file_path: str, file_ext: str) -> str:
        """The web addresses behind clickable words in a PDF or Word file, one per line ('' when there are none).

        A CV often shows only the word "LinkedIn" or "GitHub" with the address attached to it as a link, so the address is not in
        the visible text. This reads those links so the profile can still be found. A failure here never stops the CV."""
        urls: list[str] = []
        try:
            if file_ext == '.pdf':
                doc = fitz.open(file_path)
                try:
                    for page_num in range(min(len(doc), 20)):
                        urls += [str(link.get("uri")) for link in doc.load_page(page_num).get_links() if link.get("uri")]
                finally:
                    doc.close()
            elif file_ext in ('.docx', '.doc') and zipfile.is_zipfile(file_path):
                document = docx.Document(file_path)
                parts = [document.part] + [p for s in document.sections for p in (s.header.part, s.footer.part)]
                for part in parts:
                    urls += [rel.target_ref for rel in part.rels.values()
                             if rel.is_external and str(rel.reltype).endswith("/hyperlink")]
        except Exception as e:  # noqa: BLE001
            self.logger.debug(f"Could not read hyperlinks from {file_path}: {e}")
        return chr(10).join(dict.fromkeys(u for u in urls if u))[:20000]

    def extract_text_from_word(self, file_path: str) -> str:
        """.docx (zip) goes through python-docx. A genuine legacy .doc (OLE) is read with antiword; a .docx that was
        saved with a .doc extension is detected by its zip header and read as .docx."""
        with open(file_path, "rb") as fh:
            head = fh.read(4)
        if head[:2] == b"PK":
            return self.extract_text_from_docx(file_path)
        try:
            result = subprocess.run(["antiword", "-m", "UTF-8.txt", file_path], capture_output=True, timeout=30)
        except FileNotFoundError:
            raise ValueError("Legacy .doc files need the 'antiword' tool, which is not installed on this host")
        except subprocess.TimeoutExpired:
            raise ValueError("Reading the .doc file timed out")
        if result.returncode != 0:
            raise ValueError(f"Could not read the .doc file: {result.stderr.decode('utf-8', 'ignore').strip()[:200]}")
        return result.stdout.decode("utf-8", "ignore").strip()

    def extract_text_from_rtf(self, file_path: str) -> str:
        from striprtf.striprtf import rtf_to_text

        with open(file_path, "r", encoding="latin-1", errors="ignore") as fh:
            return rtf_to_text(fh.read()).strip()

    def extract_text_from_odt(self, file_path: str) -> str:
        """OpenDocument text: paragraphs and headings from content.xml (a zip container, so no extra library)."""
        import xml.etree.ElementTree as ET

        with zipfile.ZipFile(file_path) as zf:
            xml = zf.read("content.xml")
            if b"<!DOCTYPE" in xml[:4096].upper() or b"<!ENTITY" in xml.upper():       # a real ODT has neither; both are how XML bombs are built
                raise ValueError("The document's XML declares entities, which is not allowed")
            root = ET.fromstring(xml)  # nosec B314: DTDs and entities are refused just above
        ns = "{urn:oasis:names:tc:opendocument:xmlns:text:1.0}"
        lines = []
        for el in root.iter():
            if el.tag in (ns + "p", ns + "h"):
                lines.append("".join(el.itertext()).strip())
        return "\n".join(line for line in lines if line).strip()

    def extract_text_from_html(self, file_path: str) -> str:
        class _Text(HTMLParser):
            BLOCKS = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "table"}

            def __init__(self) -> None:
                super().__init__()
                self.parts: list = []
                self._skip = 0

            def handle_starttag(self, tag, attrs):
                if tag in ("script", "style"):
                    self._skip += 1
                elif tag in self.BLOCKS:
                    self.parts.append("\n")

            def handle_endtag(self, tag):
                if tag in ("script", "style"):
                    self._skip = max(0, self._skip - 1)
                elif tag in self.BLOCKS:
                    self.parts.append("\n")

            def handle_data(self, data):
                if not self._skip:
                    self.parts.append(data)

        with open(file_path, "r", encoding="utf-8", errors="ignore") as fh:
            parser = _Text()
            parser.feed(fh.read())
        text = html_lib.unescape("".join(parser.parts))
        return re.sub(r"\n\s*\n+", "\n", re.sub(r"[ \t]+", " ", text)).strip()

    def extract_text_from_docx(self, file_path: str) -> str:
        """
        Extract text from DOCX files using python-docx.
        Includes paragraphs and tables.
        """
        try:
            self.logger.info(f"Extracting text from DOCX: {file_path}")
            
            document = docx.Document(file_path)
            text_parts = []
            
            # Extract paragraphs
            for paragraph in document.paragraphs:
                if paragraph.text.strip():
                    text_parts.append(paragraph.text.strip())
            
            # Extract tables
            for table in document.tables:
                table_text = []
                for row in table.rows:
                    row_text = []
                    for cell in row.cells:
                        if cell.text.strip():
                            row_text.append(cell.text.strip())
                    if row_text:
                        table_text.append(" | ".join(row_text))
                
                if table_text:
                    text_parts.append("\n--- Table Data ---")
                    text_parts.extend(table_text)
            
            extracted_text = "\n".join(text_parts).strip()
            
            if not extracted_text:
                raise ValueError("No text could be extracted from DOCX file")
                
            self.logger.info(f"DOCX extraction successful: {len(extracted_text):,} characters")
            return extracted_text
            
        except Exception as e:
            self.logger.error(f"DOCX extraction failed: {str(e)}")
            raise Exception(f"DOCX extraction failed: {str(e)}")
    
    def extract_with_ocr(self, file_path: str) -> str:
        """OCR for image files (PNG/JPG/TIFF/BMP)."""
        try:
            self.logger.info(f"Performing OCR on image: {file_path}")
            text = ocr_image(Image.open(file_path))
            if not text.strip():
                raise ValueError("No text could be extracted via OCR")
            self.logger.info(f"OCR extraction successful: {len(text):,} characters")
            return text.strip()
        except Exception as e:
            self.logger.error(f"OCR extraction failed: {str(e)}")
            raise Exception(f"OCR extraction failed: {str(e)}")

    def _extract_text_from_txt(self, file_path: str) -> str:
        """Extract text from plain text files with encoding detection."""
        try:
            # Try different encodings
            encodings = ['utf-8', 'latin-1', 'cp1252']
            
            for encoding in encodings:
                try:
                    with open(file_path, 'r', encoding=encoding) as file:
                        text = file.read()
                        return text.strip()
                except UnicodeDecodeError:
                    continue
            
            # If all encodings fail, use utf-8 with error handling
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as file:
                text = file.read()
                return text.strip()
                
        except Exception as e:
            raise Exception(f"Failed to read text file: {str(e)}")
    
    def _perform_ocr_on_bytes(self, image_bytes: bytes) -> str:
        """OCR PNG bytes; an unreadable image yields '' rather than failing the whole document."""
        try:
            return ocr_png(image_bytes)
        except Exception as e:  # noqa: BLE001
            self.logger.warning(f"OCR failed for an image: {e}")
            return ""

    def remove_pii_data(self, text: str, link_text: str = "") -> tuple[str, dict]:
        """Replace e-mails and phone numbers with [EMAIL] / [PHONE] and return (clean_text, extracted_pii).
        ``extracted_pii`` also lists the candidate's LinkedIn and GitHub links (``link_text`` adds the addresses behind clickable
        words in the original file); those are blanked out of the returned text as [LINKEDIN] / [GITHUB] too.

        ``extracted_pii`` lists the addresses and numbers found, the candidate's own first (header before body, referees
        last, IDs and date ranges excluded). Everything numeric-looking is redacted regardless. See contact.py."""
        # Ranked, candidate-first lists (see app/ingestion/contact.py); every match is still redacted from the text.
        found = extract_contacts(text, link_text)
        extracted_pii = {"email": found["emails"], "phone": found["phones"],
                         "linkedin": found["linkedin"], "github": found["github"], "github_repo_only": found["github_repo_only"]}
        email_spans = found["email_spans"]
        phone_spans = found["redact"]
        link_placeholders = {s: placeholder for s, _, placeholder in found["link_spans"]}
        link_spans = [(s, e) for s, e, _ in found["link_spans"]]

        # ---- Build clean_text by merging all spans (email + phone) and ----
        # ---- replacing each with a single placeholder, left to right. ----
        all_spans = sorted(email_spans + phone_spans + link_spans)
        merged: list[list[int]] = []
        for start, end in all_spans:
            if merged and start <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], end)
            else:
                merged.append([start, end])

        pieces = []
        cursor = 0
        email_span_set = set(email_spans)
        for start, end in merged:
            pieces.append(text[cursor:start])
            # A merged span that grew from overlapping email+phone matches is
            # still just one PII item, tag it using whichever type it started as.
            placeholder = link_placeholders.get(start) or ('[EMAIL]' if (start, end) in email_span_set or any(
                s == start for s, _ in email_spans
            ) else '[PHONE]')
            pieces.append(placeholder)
            cursor = end
        pieces.append(text[cursor:])
        clean_text = ''.join(pieces)

        # Clean up multiple whitespaces
        clean_text = re.sub(r'\s+', ' ', clean_text).strip()

        return clean_text, extracted_pii

# Global instance
_parsing_service: Optional[ParsingService] = None

def get_parsing_service() -> ParsingService:
    """Get global parsing service instance."""
    global _parsing_service
    if _parsing_service is None:
        _parsing_service = ParsingService()
    return _parsing_service
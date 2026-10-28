"""
Parsing Service - Consolidated Document Processing
Handles ALL text extraction from various file formats with PII removal.
Single responsibility: Extract clean text from documents.
"""
import logging
import os
import re
import subprocess
import signal
from typing import Dict, Any, Optional, Tuple
from pathlib import Path
import tempfile
import shutil
import threading

# Document processing libraries
import fitz  # PyMuPDF for PDF
import docx  # python-docx for DOCX
import pytesseract  # OCR for images
from PIL import Image
from io import BytesIO
import phonenumbers  # Google's libphonenumber port — see remove_pii_data() for why



logger = logging.getLogger(__name__)

# Countries most likely to appear in this platform's candidate pool (GCC +
# South Asia + a few global anchors). Used as region *hints* only: a hint
# tells libphonenumber how to interpret a number that has no explicit
# country code / '+' prefix (e.g. a bare local mobile number). Numbers that
# already carry a country code (with '+' or a '00' access code) are matched
# correctly regardless of which hint found them, since phonenumbers parses
# the actual digits, not just the hint's own country. We only need the union
# of matched character spans across every hint below, so overlap between
# hints is harmless — see remove_pii_data().
_PHONE_REGION_HINTS = [
    "AE", "SA", "QA", "KW", "BH", "OM", "JO", "LB", "EG",  # GCC / Levant / Egypt
    "IN", "PK", "BD", "PH", "NP", "LK",                     # South / SE Asia
    "GB", "US",                                             # global anchors
]

# Safety-net pattern for anything the above still misses: any run of 9+
# digits (optionally grouped with spaces/dashes/dots/parens) is far more
# likely to be a phone number than legitimate free-text content in a CV —
# genuine 9+ digit sequences (IDs, reference numbers) are rare, and erring
# toward redacting too much is the correct tradeoff for PII sent to an LLM.
# Deliberately >= 9 (not >= 7) so date ranges like "2015 - 2020" and short
# reference codes never get caught.
_PHONE_FALLBACK_PATTERN = re.compile(r'(?:\+?\d[\d\-.\s()]{7,}\d)')


def _looks_like_enough_digits(candidate: str, minimum: int = 9) -> bool:
    return sum(c.isdigit() for c in candidate) >= minimum


class ParsingService:
    """
    Consolidated service for all document text extraction and processing.
    Combines PDF, DOCX, OCR, and PII removal into a single clean interface.
    """
    
    # Supported file extensions
    SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.doc', '.txt', '.png', '.jpg', '.jpeg', '.tiff', '.bmp']
    MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
    OCR_TIMEOUT = 60  # 60 seconds timeout for OCR operations
    OCR_USE_TIMEOUT = True  # Flag to enable/disable timeout protection
    
    def __init__(self):
        """Initialize the parsing service."""
        self.logger = logger
        self.logger.info("🔧 ParsingService initialized")
    
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
            
            self.logger.info(f"📄 Processing document: {file_path} ({file_size:,} bytes)")
            
            # Extract text based on file type
            ocr_used = False
            if file_ext == '.pdf':
                raw_text, ocr_used = self.extract_text_from_pdf(file_path)
            elif file_ext in ['.docx', '.doc']:
                raw_text = self.extract_text_from_docx(file_path)
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
            
            # Remove PII data
            clean_text, extracted_pii = self.remove_pii_data(raw_text)
            
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

            self.logger.info(f"✅ Document processed successfully: {len(clean_text):,} characters")
            return result
            
        except Exception as e:
            self.logger.error(f"❌ Document processing failed: {str(e)}")
            raise Exception(f"Document processing failed: {str(e)}")
    
    def extract_text_from_pdf(self, file_path: str) -> Tuple[str, bool]:
        """
        Extract text from PDF files using PyMuPDF.
        Combines all PDF extraction logic into one optimized function.
        """
        try:
            self.logger.info(f"📖 Extracting text from PDF: {file_path}")
            
            doc = fitz.open(file_path)
            text_parts = []
            ocr_used = False
            
            for page_num in range(len(doc)):
                page = doc.load_page(page_num)
                page_text = page.get_text()

                if page_text.strip():  # Only add pages with content
                    text_parts.append(page_text)

                if len(page_text.strip()) >= 100:
                    continue  # plenty of real text already — this page needs no OCR

                # Sparse/empty text layer: this page is almost certainly a scan.
                ocr_used = True
                self.logger.info(f"🔍 OCR needed for page {page_num + 1} (sparse text: {len(page_text.strip())} chars)")
                ocr_text = ""
                try:
                    # Prefer OCR-ing the embedded raster image(s) directly —
                    # usually sharper than re-rasterizing the whole page.
                    # CMYK images (pix.n - pix.alpha >= 4) are converted to RGB
                    # instead of being silently skipped, as they used to be.
                    for img in page.get_images():
                        xref = img[0]
                        pix = fitz.Pixmap(doc, xref)
                        if pix.n - pix.alpha >= 4:
                            pix = fitz.Pixmap(fitz.csRGB, pix)
                        ocr_text += self._perform_ocr_on_bytes(pix.tobytes("png")) + "\n"
                        pix = None
                except Exception as ocr_error:
                    self.logger.warning(f"Embedded-image OCR failed for page {page_num + 1}: {str(ocr_error)}")

                if len(ocr_text.strip()) < 20:
                    # No embedded images were found (or they yielded nothing
                    # usable) — fall back to rasterizing the page exactly as it
                    # would be displayed, so OCR always gets a real attempt at
                    # any scan regardless of how the PDF encodes it internally
                    # (this is what actually made the difference for PDFs whose
                    # scan isn't a plain get_images()-visible XObject).
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
                self.logger.info(f"✅ PDF extraction successful with OCR: {len(extracted_text):,} characters")
            else:
                self.logger.info(f"✅ PDF extraction successful: {len(extracted_text):,} characters")
            return extracted_text, ocr_used
            
        except Exception as e:
            self.logger.error(f"❌ PDF extraction failed: {str(e)}")
            raise Exception(f"PDF extraction failed: {str(e)}")
    
    def extract_text_from_docx(self, file_path: str) -> str:
        """
        Extract text from DOCX files using python-docx.
        Includes paragraphs and tables.
        """
        try:
            self.logger.info(f"📝 Extracting text from DOCX: {file_path}")
            
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
                
            self.logger.info(f"✅ DOCX extraction successful: {len(extracted_text):,} characters")
            return extracted_text
            
        except Exception as e:
            self.logger.error(f"❌ DOCX extraction failed: {str(e)}")
            raise Exception(f"DOCX extraction failed: {str(e)}")
    
    def extract_with_ocr(self, file_path: str) -> str:
        """
        OCR fallback for image-based documents using pytesseract with timeout protection.
        """
        try:
            self.logger.info(f"🔍 Performing OCR on image: {file_path} (timeout: {self.OCR_TIMEOUT}s)")
            
            image = Image.open(file_path)
            text = self._perform_ocr_with_timeout(image, config='--psm 1')
            
            if not text.strip():
                raise ValueError("No text could be extracted via OCR")
                
            self.logger.info(f"✅ OCR extraction successful: {len(text):,} characters")
            return text.strip()
            
        except TimeoutError:
            self.logger.error(f"⏱️ OCR timeout after {self.OCR_TIMEOUT}s for: {file_path}")
            raise Exception(f"OCR processing timed out after {self.OCR_TIMEOUT} seconds. The image may be too complex or corrupted.")
        except Exception as e:
            self.logger.error(f"❌ OCR extraction failed: {str(e)}")
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
        """Perform OCR on image bytes with timeout protection."""
        try:
            image = Image.open(BytesIO(image_bytes))
            text = self._perform_ocr_with_timeout(image, config='--psm 1')
            return text.strip()
        except TimeoutError:
            self.logger.warning("⏱️ OCR timeout for image bytes, skipping...")
            return ""
        except Exception:
            return ""
    
    def _perform_ocr_with_timeout(self, image: Image.Image, config: str = '--psm 1') -> str:
        """
        Perform OCR with timeout protection using subprocess.
        This prevents Tesseract from hanging indefinitely on problematic images.
        """
        if not self.OCR_USE_TIMEOUT:
            # Fallback to direct pytesseract call if timeout is disabled
            return pytesseract.image_to_string(image, config=config)
        
        try:
            # Save image to temporary file for subprocess
            import tempfile
            with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp_file:
                tmp_path = tmp_file.name
                image.save(tmp_path, 'PNG')
            
            try:
                # Get tesseract command
                tesseract_cmd = pytesseract.pytesseract.tesseract_cmd
                if not tesseract_cmd:
                    # Fallback if tesseract_cmd is not set
                    tesseract_cmd = 'tesseract'

                # Build command: `tesseract <input> stdout <config args...>`.
                # config (e.g. "--psm 1") must be split into separate argv
                # entries — a single "--psm 1" string is rejected by tesseract.
                import shlex
                cmd = [tesseract_cmd, tmp_path, 'stdout', *shlex.split(config or "")]

                # Run with timeout
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=self.OCR_TIMEOUT,
                    check=False
                )
                
                if result.returncode == 0:
                    return result.stdout.strip()
                else:
                    self.logger.warning(f"Tesseract returned error code {result.returncode}: {result.stderr}")
                    return ""
                    
            except subprocess.TimeoutExpired:
                self.logger.error(f"⏱️ OCR subprocess timeout after {self.OCR_TIMEOUT}s")
                raise TimeoutError(f"OCR processing timed out after {self.OCR_TIMEOUT} seconds")
            except FileNotFoundError:
                self.logger.warning("Tesseract not found, falling back to direct pytesseract call")
                # Fallback to direct call if subprocess fails
                return pytesseract.image_to_string(image, config=config)
            finally:
                # Clean up temp file
                try:
                    os.unlink(tmp_path)
                except:
                    pass
                    
        except TimeoutError:
            raise  # Re-raise timeout errors
        except Exception as e:
            self.logger.warning(f"Subprocess OCR failed, falling back to direct call: {str(e)}")
            # Fallback to direct pytesseract call if subprocess fails
            try:
                return pytesseract.image_to_string(image, config=config)
            except Exception as fallback_error:
                self.logger.error(f"OCR fallback also failed: {str(fallback_error)}")
                raise
    
    def remove_pii_data(self, text: str) -> tuple[str, dict]:
        """
        Remove PII from text and return cleaned text plus extracted PII.
        Returns tuple: (clean_text, extracted_pii)

        Phone detection uses Google's libphonenumber (the `phonenumbers`
        package) instead of hand-rolled regexes. A prior regex-only version
        of this method reliably caught US-style (123) 456-7890 / 10-digit /
        '+'-prefixed numbers but silently missed a lot of real-world CV
        formats: numbers written with a '00' international access code
        instead of '+' (e.g. "0044 7911 123456"), bare local numbers with a
        country code but no '+' (e.g. "919876543210"), and local formats
        whose digit grouping didn't match any of the fixed patterns (e.g.
        Singapore's "6512 3456"). Those would have gone into the LLM prompt
        completely unredacted. See _PHONE_REGION_HINTS above for why this
        runs libphonenumber's matcher once per region hint and unions the
        results instead of relying on one guessed region.
        """
        extracted_pii = {"email": [], "phone": []}

        # ---- Email --------------------------------------------------------
        email_pattern = r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'
        email_spans = [m.span() for m in re.finditer(email_pattern, text)]
        if email_spans:
            extracted_pii["email"] = list(dict.fromkeys(text[s:e] for s, e in email_spans))

        # ---- Phone: libphonenumber across every region hint + no-region ---
        # (region=None only matches numbers that already carry an explicit
        # country code; the hints below additionally catch bare local numbers.)
        phone_spans: list[tuple[int, int]] = []
        raw_phones: list[str] = []
        for region in [None] + _PHONE_REGION_HINTS:
            try:
                for match in phonenumbers.PhoneNumberMatcher(text, region):
                    if not phonenumbers.is_valid_number(match.number):
                        continue
                    phone_spans.append((match.start, match.end))
                    raw_phones.append(match.raw_string)
            except Exception as e:  # noqa: BLE001 - matcher must never break parsing
                self.logger.debug(f"phonenumbers matcher failed for region={region}: {e}")

        # ---- Phone fallback: catch anything libphonenumber still missed ---
        # (e.g. a typo'd number, or a format no real country uses but still
        # reads as a phone number). Only applied outside spans already found
        # above, and only kept if it has enough digits to plausibly be one.
        for m in _PHONE_FALLBACK_PATTERN.finditer(text):
            if _looks_like_enough_digits(m.group()):
                if not any(m.start() < e and s < m.end() for s, e in phone_spans):
                    phone_spans.append((m.start(), m.end()))
                    raw_phones.append(m.group())

        if raw_phones:
            extracted_pii["phone"] = list(dict.fromkeys(raw_phones))

        # ---- Build clean_text by merging all spans (email + phone) and ----
        # ---- replacing each with a single placeholder, left to right. ----
        all_spans = sorted(email_spans + phone_spans)
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
            # still just one PII item — tag it using whichever type it started as.
            placeholder = '[EMAIL]' if (start, end) in email_span_set or any(
                s == start for s, _ in email_spans
            ) else '[PHONE]'
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
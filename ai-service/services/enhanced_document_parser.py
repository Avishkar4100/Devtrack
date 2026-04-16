"""Enhanced document parsing with validation, magic number detection, and detailed error logging."""

import os
import json
import logging
from dataclasses import dataclass
from typing import Optional, Dict, Any, Tuple

logger = logging.getLogger(__name__)


@dataclass
class ParseResult:
    """Result of parsing operation with metadata."""
    text: str
    metadata: Dict[str, Any]
    success: bool
    error: Optional[str] = None
    
    def to_dict(self):
        return {
            "text": self.text,
            "metadata": self.metadata,
            "success": self.success,
            "error": self.error,
        }


class FileTypeMismatchError(Exception):
    """Raised when detected file type doesn't match provided extension."""
    pass


class ParseValidationError(Exception):
    """Raised when parsed content fails validation."""
    pass


class EnhancedDocumentParser:
    """Enhanced document parser with magic number detection and validation."""
    
    # Magic numbers for file type detection (bytes to check)
    MAGIC_NUMBERS = {
        "pdf": (b"%PDF", "PDF"),
        "docx": (b"PK\x03\x04", "DOCX/ZIP"),
        "doc": (b"\xd0\xcf\x11\xe0", "DOC/OLE"),
        "txt": (None, "TEXT"),  # Text files have no specific magic number
        "md": (None, "MARKDOWN"),
    }
    
    # Minimum thresholds for validation
    MIN_TEXT_LENGTH = 50  # Minimum characters
    MIN_CONTENT_RATIO = 0.3  # Minimum ratio of meaningful content (non-whitespace)

    @staticmethod
    def split_by_headings(text: str) -> list[dict]:
        """Split text into heading-aware sections (Markdown or numbered headings)."""
        if not text or not text.strip():
            return []

        lines = text.splitlines()
        sections = []
        current_title = "Preamble"
        current_body = []
        heading_re = __import__("re").compile(r"^\s*(#{1,6}\s+.+|\d+(?:\.\d+){0,3}\s+.+)\s*$")

        for line in lines:
            if heading_re.match(line):
                body_text = "\n".join(current_body).strip()
                if body_text:
                    sections.append({"heading": current_title, "text": body_text})
                current_title = line.strip().lstrip("#").strip()
                current_body = []
            else:
                current_body.append(line)

        tail_text = "\n".join(current_body).strip()
        if tail_text:
            sections.append({"heading": current_title, "text": tail_text})

        if not sections:
            return [{"heading": "Document", "text": text.strip()}]
        return sections
    
    @staticmethod
    def detect_file_type(file_path: str) -> Tuple[str, str]:
        """
        Detect actual file type using magic numbers, not just extension.
        Returns: (detected_type, method)
        """
        try:
            with open(file_path, "rb") as f:
                header = f.read(4)
        except Exception as e:
            logger.warning(f"Could not read file header: {e}")
            # Fall back to extension
            return EnhancedDocumentParser._get_type_from_extension(file_path), "extension"
        
        # Check magic numbers
        for file_type, (magic, name) in EnhancedDocumentParser.MAGIC_NUMBERS.items():
            if magic and header.startswith(magic):
                logger.debug(f"Detected {name} format for {file_path}")
                return file_type, "magic_number"
        
        # Fall back to extension
        ext_type = EnhancedDocumentParser._get_type_from_extension(file_path)
        logger.debug(f"Using extension-based detection: {ext_type}")
        return ext_type, "extension"
    
    @staticmethod
    def _get_type_from_extension(file_path: str) -> str:
        """Get file type from file extension."""
        _, ext = os.path.splitext(file_path)
        ext = ext.lower().lstrip(".")
        
        if ext == "pdf":
            return "pdf"
        elif ext in ("docx", "doc"):
            return "docx" if ext == "docx" else "doc"
        elif ext == "md":
            return "md"
        elif ext == "txt":
            return "txt"
        else:
            return "txt"  # Default to text
    
    @staticmethod
    def validate_extracted_text(text: str, file_type: str) -> Tuple[bool, Optional[str]]:
        """
        Validate extracted text quality.
        Returns: (is_valid, error_message)
        """
        if not text:
            return False, "Extracted text is empty"
        
        if len(text.strip()) < EnhancedDocumentParser.MIN_TEXT_LENGTH:
            return False, f"Extracted text too short ({len(text.strip())} chars, minimum {EnhancedDocumentParser.MIN_TEXT_LENGTH})"
        
        # Check content ratio (non-whitespace vs total)
        non_whitespace = len(text.split())
        total_length = len(text)
        if total_length > 0:
            content_ratio = non_whitespace / (total_length / 10)  # Rough estimate
            if content_ratio < EnhancedDocumentParser.MIN_CONTENT_RATIO:
                return False, f"Low content quality: mostly whitespace or formatting"
        
        return True, None
    
    @staticmethod
    def parse_document(
        file_path: str,
        file_type: str,
        validate: bool = True,
        check_magic: bool = True
    ) -> ParseResult:
        """
        Parse document with enhanced validation and error reporting.
        """
        try:
            # Validate file exists
            if not os.path.exists(file_path):
                raise FileNotFoundError(f"File not found: {file_path}")
            
            metadata = {
                "file_path": file_path,
                "provided_type": file_type,
                "detected_type": None,
                "detection_method": None,
                "validation_passed": False,
                "text_length": 0,
                "word_count": 0,
                "parsing_stage": "initialization",
                "warnings": [],
            }
            
            # Step 1: File type detection
            if check_magic:
                try:
                    detected_type, method = EnhancedDocumentParser.detect_file_type(file_path)
                    metadata["detected_type"] = detected_type
                    metadata["detection_method"] = method
                    
                    # Check for type mismatch
                    if detected_type != file_type.lower() and method == "magic_number":
                        warning = f"File type mismatch: provided={file_type}, detected={detected_type}"
                        metadata["warnings"].append(warning)
                        logger.warning(warning)
                        # Use detected type for parsing
                        file_type = detected_type
                except Exception as e:
                    metadata["warnings"].append(f"Magic number detection failed: {str(e)}")
                    logger.warning(f"Magic number detection failed: {e}")
            
            # Step 2: Parse document
            metadata["parsing_stage"] = "parsing"
            text = EnhancedDocumentParser._parse_by_type(file_path, file_type.lower())
            
            metadata["parsing_stage"] = "validation"
            metadata["text_length"] = len(text)
            metadata["word_count"] = len(text.split())
            sections = EnhancedDocumentParser.split_by_headings(text)
            metadata["section_count"] = len(sections)
            metadata["headings"] = [s.get("heading") for s in sections[:50]]
            
            # Step 3: Validate extracted text
            if validate:
                is_valid, error_msg = EnhancedDocumentParser.validate_extracted_text(text, file_type)
                if not is_valid:
                    return ParseResult(
                        text="",
                        metadata=metadata,
                        success=False,
                        error=error_msg
                    )
                metadata["validation_passed"] = True
            
            metadata["parsing_stage"] = "complete"
            return ParseResult(
                text=text.strip(),
                metadata=metadata,
                success=True
            )
            
        except Exception as e:
            logger.error(f"Document parsing failed at {metadata.get('parsing_stage', 'unknown')}: {e}")
            return ParseResult(
                text="",
                metadata=metadata,
                success=False,
                error=f"Parsing failed: {str(e)}"
            )
    
    @staticmethod
    def _parse_by_type(file_path: str, file_type: str) -> str:
        """Parse document based on type."""
        file_type = file_type.lower()
        
        if file_type == "pdf":
            return EnhancedDocumentParser._parse_pdf(file_path)
        elif file_type in ("docx", "doc"):
            return EnhancedDocumentParser._parse_docx(file_path)
        elif file_type in ("txt", "md"):
            return EnhancedDocumentParser._parse_txt(file_path)
        else:
            raise ValueError(f"Unsupported file type: {file_type}")
    
    @staticmethod
    def _parse_pdf(file_path: str) -> str:
        """Parse PDF file with fallback support."""
        try:
            import fitz  # PyMuPDF
            doc = fitz.open(file_path)
            text = ""
            page_count = doc.page_count
            
            for page_num, page in enumerate(doc):
                page_text = page.get_text()
                if page_text.strip():
                    text += page_text
                else:
                    logger.warning(f"PDF page {page_num} appears empty")
            
            doc.close()
            logger.debug(f"Successfully parsed PDF: {page_count} pages, {len(text)} characters")
            return text.strip()
            
        except ImportError:
            logger.info("fitz not available, trying pdfplumber fallback...")
            # Fallback: try pdfplumber
            try:
                import pdfplumber
                with pdfplumber.open(file_path) as pdf:
                    pages_data = []
                    for page_num, page in enumerate(pdf.pages):
                        page_text = page.extract_text() or ""
                        if page_text.strip():
                            pages_data.append(page_text)
                        else:
                            logger.warning(f"PDF page {page_num} appears empty")
                    
                    text = "\n".join(pages_data)
                    logger.debug(f"Successfully parsed PDF with pdfplumber: {len(pdf.pages)} pages")
                    return text.strip()
                    
            except Exception as e:
                raise RuntimeError(f"PDF parsing failed (fitz: not installed, pdfplumber: {e})")
    
    @staticmethod
    def _parse_docx(file_path: str) -> str:
        """Parse DOCX/DOC file."""
        try:
            from docx import Document
            doc = Document(file_path)
            
            paragraphs = []
            for para in doc.paragraphs:
                if para.text.strip():
                    paragraphs.append(para.text)
            
            # Also extract from tables
            for table in doc.tables:
                for row in table.rows:
                    row_text = " | ".join(cell.text.strip() for cell in row.cells)
                    if row_text.strip():
                        paragraphs.append(row_text)
            
            text = "\n".join(paragraphs)
            logger.debug(f"Successfully parsed DOCX: {len(paragraphs)} paragraphs, {len(text)} characters")
            return text.strip()
            
        except Exception as e:
            raise RuntimeError(f"DOCX parsing failed: {e}")
    
    @staticmethod
    def _parse_txt(file_path: str) -> str:
        """Parse text file."""
        try:
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                text = f.read()
            logger.debug(f"Successfully parsed text file: {len(text)} characters")
            return text.strip()
        except Exception as e:
            raise RuntimeError(f"Text file parsing failed: {e}")


# Backward compatibility: wrap old function interface
def parse_document(file_path: str, file_type: str) -> str:
    """
    Parse document (backward compatible with original API).
    Raises HTTPException-style errors.
    """
    result = EnhancedDocumentParser.parse_document(
        file_path=file_path,
        file_type=file_type,
        validate=True,
        check_magic=True
    )
    
    if not result.success or not result.text:
        raise RuntimeError(result.error or "Unknown parsing error")
    
    return result.text

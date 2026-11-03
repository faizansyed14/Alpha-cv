"""
Email CV Processor - Integrates Azure Email Service with CV Processing Pipeline
================================================================================

This service bridges the gap between email processing and CV processing:
1. Takes processed emails from Azure Email Service
2. Extracts CV attachments and saves them temporarily
3. Processes CVs through the existing CV processing pipeline
4. Creates job applications in the database
5. Sends confirmation emails to applicants
"""

import asyncio
import logging
import os
import tempfile
import uuid
from datetime import datetime
from typing import Dict, List, Optional, Any
import base64
import hashlib

from app.integrations.email.azure_email_service import ProcessedEmail, get_azure_email_service
from app.ingestion.pipeline import SOURCE_EMAIL, CVSubmission, DuplicateApplication, ingest_cv
from app.providers.vectorstore.qdrant import get_qdrant_utils
from app.providers.storage import get_storage_service

logger = logging.getLogger(__name__)

class EmailCVProcessor:
    """Processes CV attachments from emails through the existing CV pipeline"""
    
    def __init__(self):
        self.azure_email_service = get_azure_email_service()
        self.qdrant = get_qdrant_utils()
        self.s3_service = get_storage_service()
        
        logger.info("EmailCVProcessor initialized")
    
    async def save_cv_attachment(self, attachment: Dict[str, Any], application_id: str) -> str:
        """Save CV attachment to temporary file and upload to S3"""
        try:
            # Decode base64 content
            content_bytes = base64.b64decode(attachment['content_bytes'])
            
            file_ext = attachment['file_extension']
            with tempfile.NamedTemporaryFile(delete=False, suffix=file_ext) as tmp:
                tmp.write(content_bytes)
                temp_path = tmp.name

            try:
                s3_path = self.s3_service.upload_file(temp_path, application_id, "cv", file_ext)
            finally:
                try:
                    os.unlink(temp_path)
                except OSError:
                    pass

            logger.info(f"Uploaded CV to S3: {s3_path}")
            return s3_path
        
        except Exception as e:
            logger.error(f"Failed to save CV attachment: {e}")
            raise
    
    async def process_cv_from_email(self, processed_email: ProcessedEmail) -> Dict[str, Any]:
        """Process a single CV from email through the complete pipeline"""
        try:
            logger.info(f"Processing CV from email: {processed_email.email_id}")
            
            if not processed_email.cv_attachments:
                raise Exception("No CV attachments to process")
            
            # Check for duplicate application (same email + job posting)
            if processed_email.job_posting_id:
                existing_application = self.qdrant.check_existing_application(
                    applicant_email=processed_email.applicant_email,
                    job_posting_id=processed_email.job_posting_id
                )
                
                if existing_application:
                    logger.warning(f"Duplicate application detected: {processed_email.applicant_email} already applied to job {processed_email.job_posting_id}")
                    logger.info(f"Existing application ID: {existing_application['id']}, Date: {existing_application['application_date']}")
                    
                    # Mark email as processed even though it's a duplicate (to prevent reprocessing)
                    self.azure_email_service.processed_emails.add(processed_email.email_id)
                    self.azure_email_service.db_service.mark_email_processed(
                        email_id=processed_email.email_id,
                        subject=f"DUPLICATE: {processed_email.job_title or 'Job Application'}",
                        sender_email=processed_email.applicant_email
                    )
                    
                    return {
                        "success": False,
                        "duplicate": True,
                        "email_id": processed_email.email_id,
                        "applicant_email": processed_email.applicant_email,
                        "job_posting_id": processed_email.job_posting_id,
                        "existing_application_id": existing_application['id'],
                        "existing_application_date": existing_application['application_date'],
                        "message": f"Application already exists for this job. Previous application submitted on {existing_application['application_date']}"
                    }
            
            # Use the first CV attachment (could be extended to handle multiple)
            cv_attachment = processed_email.cv_attachments[0]

            # Generate application ID (also the CV record's id, as for job-page applications)
            application_id = str(uuid.uuid4())

            # Keep the original attachment in storage, then run the same pipeline as every other door.
            cv_path = await self.save_cv_attachment(cv_attachment, application_id)
            content_sha256 = hashlib.sha256(base64.b64decode(cv_attachment['content_bytes'])).hexdigest()

            expected_salary = None
            if processed_email.email_body:
                expected_salary = self.azure_email_service.extract_expected_salary(processed_email.email_body)

            job = ({"job_id": processed_email.job_posting_id, "job_title": processed_email.job_title,
                    "subject_id": processed_email.subject_id, "email_id": processed_email.email_id,
                    "requires_manual_matching": True} if processed_email.job_posting_id else None)
            submission = CVSubmission(
                source=SOURCE_EMAIL, cv_id=application_id, filename=cv_attachment['name'], persisted_path=cv_path,
                mime_type=cv_attachment.get('content_type'), content_sha256=content_sha256,
                candidate={"expected_salary": expected_salary},
                # the sender may be a job-board relay (Naukri), so it only stands in when the CV shows no e-mail
                hints={"email": processed_email.applicant_email}, job=job,
            )
            # Matching is NOT run here: HR matches from the careers page, through the same queue as any other CV.
            try:
                outcome = await asyncio.to_thread(ingest_cv, submission)
            except DuplicateApplication as dup:   # raced with another door between the check above and storing
                self.azure_email_service.processed_emails.add(processed_email.email_id)
                self.azure_email_service.db_service.mark_email_processed(
                    email_id=processed_email.email_id,
                    subject=f"DUPLICATE: {processed_email.job_title or 'Job Application'}",
                    sender_email=processed_email.applicant_email)
                return {"success": False, "duplicate": True, "email_id": processed_email.email_id,
                        "applicant_email": processed_email.applicant_email,
                        "job_posting_id": processed_email.job_posting_id,
                        "existing_application_id": dup.existing_id, "existing_application_date": dup.applied_on,
                        "message": str(dup)}

            applicant_name = outcome.standardized.get("name", "Unknown Applicant")
            self.azure_email_service.processed_emails.add(processed_email.email_id)
            self.azure_email_service.db_service.mark_email_processed(
                email_id=processed_email.email_id,
                subject=processed_email.job_title or "Job Application",
                sender_email=processed_email.applicant_email
            )
            logger.info(f"Successfully processed CV from email: {application_id}")
            return {
                "success": True,
                "application_id": application_id,
                "cv_id": outcome.cv_id,
                "merged": outcome.merged,
                "job_posting_id": processed_email.job_posting_id,
                "job_title": processed_email.job_title,
                "applicant_name": applicant_name,
                "applicant_email": processed_email.applicant_email,
                "match_percentage": 0,  # No automatic matching
                "cv_filename": cv_attachment['name'],
                "processing_time": datetime.utcnow().isoformat(),
                "message": f"CV processed and saved - manual matching required for {applicant_name}"
            }

        except Exception as e:
            logger.error(f"Failed to process CV from email {processed_email.email_id}: {e}")
            return {
                "success": False,
                "email_id": processed_email.email_id,
                "error": str(e),
                "message": f"Failed to process CV: {str(e)}"
            }
    
    async def process_all_email_cvs(self) -> List[Dict[str, Any]]:
        """Process all CVs from unread emails"""
        try:
            logger.info("Starting email CV processing batch")
            
            # Get processed emails from Azure service
            processed_emails = await self.azure_email_service.process_all_unread_emails()
            
            if not processed_emails:
                logger.info("No emails to process")
                return []
            
            # Filter emails that are ready for CV processing
            ready_emails = [
                email for email in processed_emails 
                if email.processing_status == "ready_for_cv_processing"
            ]
            
            if not ready_emails:
                logger.info("No emails ready for CV processing")
                return []
            
            # Process each CV
            results = []
            for processed_email in ready_emails:
                try:
                    result = await self.process_cv_from_email(processed_email)
                    results.append(result)
                except Exception as e:
                    logger.error(f"Failed to process email {processed_email.email_id}: {e}")
                    results.append({
                        "success": False,
                        "email_id": processed_email.email_id,
                        "error": str(e)
                    })
            
            logger.info(f"Processed {len(results)} CVs from emails")
            return results
        
        except Exception as e:
            logger.error(f"Failed to process email CVs: {e}")
            return []
    
# Singleton instance
_email_cv_processor: Optional[EmailCVProcessor] = None

def get_email_cv_processor() -> EmailCVProcessor:
    """Get singleton instance of email CV processor"""
    global _email_cv_processor
    if _email_cv_processor is None:
        _email_cv_processor = EmailCVProcessor()
    return _email_cv_processor


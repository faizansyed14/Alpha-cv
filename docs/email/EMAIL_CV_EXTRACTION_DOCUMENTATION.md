# Email CV Extraction System Documentation

## Table of Contents
1. [Overview](#overview)
2. [How Email Extraction Works](#how-email-extraction-works)
3. [Email Subject Format & Matching](#email-subject-format--matching)
4. [Duplicate Prevention System](#duplicate-prevention-system)
5. [Data Storage in Qdrant Collections](#data-storage-in-qdrant-collections)
6. [Complete Workflow](#complete-workflow)
7. [Email Filtering Rules](#email-filtering-rules)
8. [Configuration](#configuration)

---

## Overview

The system automatically extracts CVs from emails sent to `cv@alphadatarecruitment.ae` every 5 minutes using Microsoft Graph API (Azure). It processes CVs, links them to job postings using unique subject IDs, and stores all data in Qdrant vector database.

### Key Features:
- Automated email checking every 5 minutes
- Smart email subject parsing
- Duplicate prevention at multiple levels
- Support for PDF, DOCX, DOC, and TXT attachments
- Automatic job matching via subject ID
- No manual matching - HR does matching from UI
- Complete audit trail with tracking

---

## How Email Extraction Works

### 1. **Scheduled Checking (Every 5 Minutes)**
```
Start: Application Startup → Email Scheduler Initialized
Loop: Every 5 minutes
  ├─ Connect to Azure (OAuth token)
  ├─ Query unread emails with attachments
  ├─ Process new emails only
  └─ Mark emails as processed
```

**Location**: `app/services/email_scheduler.py`
- Starts automatically when backend starts (`app/main.py` lifespan)
- Configurable interval: `EMAIL_CHECK_INTERVAL_MINUTES` (default: 5)
- Configurable batch size: `EMAIL_MAX_BATCH_SIZE` (default: 50)

### 2. **Email Processing Pipeline**

```
Email Received → Azure Mailbox (cv@alphadatarecruitment.ae)
    ↓
Scheduler Checks → Microsoft Graph API Query
    ↓
Filter Emails → Only unread + has attachments + not processed
    ↓
Parse Subject → Extract Job Title & Subject ID
    ↓
Find Job Posting → Match Subject ID in database
    ↓
Download Attachments → PDF, DOCX, DOC, TXT only
    ↓
Process CV → Parse, Extract PII, Standardize, Generate Embeddings
    ↓
Store in Database → cv_documents, cv_structured, cv_embeddings
    ↓
Link to Job → Create application record
    ↓
Mark as Processed → Add email ID to tracking file
```

---

## Email Subject Format & Matching

### **Required Email Subject Format**

For the system to correctly extract and match CVs to job postings, emails **MUST** use this format:

```
Job Title | ID-YYYY-NNN
```

**Examples:**
- `Software Engineer | SE-2025-001`
- `Data Reporting Analyst Consultancy | DRA-2025-001`
- `Senior Mobile Developer | SMD-2024-042`
- `Re: Fleet Controller / Fleet Coordinator | FCC-2025-003` (Re:/Fwd: are automatically removed)

**Subject ID Pattern:**
- 2-4 uppercase letters (job abbreviation)
- Hyphen `-`
- 4-digit year
- Hyphen `-`
- 3-digit sequence number

**Regex Pattern:** `^(.+?)\s*\|\s*([A-Z]{2,4}-\d{4}-\d{3})$`

### **When Subject ID is Generated**

The unique `email_subject_id` and `email_subject_template` are generated when:
1. **HR posts a new job** from the Careers page
2. **System auto-generates** based on job title

**Generation Logic** (`app/routes/careers_routes.py`):
```python
email_subject_id = generate_email_subject_id(job_title)
# Example: "Software Engineer" → "SE-2025-001"

email_subject_template = generate_email_subject_template(job_title, email_subject_id)
# Example: "Software Engineer | SE-2025-001"
```

**Storage Location:**
- Stored in: `job_postings_structured` collection
- Fields: `email_subject_id`, `email_subject_template`
- Created: When job is posted (lines 1397-1410 in `careers_routes.py`)

### **What Happens if Subject Doesn't Match?**

If email subject does NOT match the pattern:
- Warning logged: `"Could not parse email subject"`
- CV is NOT processed
- Email is marked as processed (won't retry)
- Status: `processing_status = "invalid_subject"`

---

## Duplicate Prevention System

The system has **THREE layers** of duplicate prevention:

### **Layer 1: Email ID Tracking (Primary)**

**File**: `/data/processed_emails.json`
**Location**: Docker volume mount

```json
[
  "AAMkAGQ3ZTk2...",
  "AAMkAGQ3ZTk3...",
  "AAMkAGQ3ZTk4..."
]
```

**How it works:**
1. Every processed email ID is stored in a JSON file
2. Before processing, system checks if email ID exists in this file
3. If exists → Skip email (never reprocess)
4. If new → Process and add to file

**Code** (`app/services/azure_email_service.py`):
```python
# Line 74-93: Load/Save processed emails
if email_id in self.processed_emails:
    continue  # Skip already processed
```

**Persistence:**
- Survives container restarts
- Stored in Docker volume: `/data`
- Never expires (permanent tracking)

### **Layer 2: Microsoft Graph API Filter**

**Query Filter:**
```
$filter: "isRead eq false and hasAttachments eq true"
$top: 50
```

**How it works:**
- Only fetches **UNREAD** emails
- Only emails **WITH attachments**
- After processing, email is marked as read (in future - not implemented yet)
- Microsoft manages read/unread state

**Code** (`app/services/azure_email_service.py` line 134):
```python
filter_params = {
    '$filter': "isRead eq false and hasAttachments eq true",
    '$top': max_emails
}
```

### **Layer 3: Qdrant Collection Deduplication**

**CV ID Generation:**
- Each CV gets a unique UUID: `cv_id = str(uuid.uuid4())`
- Same email processed twice = Different CV IDs (though this should never happen due to Layer 1)

**Application ID:**
- Each application gets unique UUID: `application_id = str(uuid.uuid4())`
- Links CV to job posting

**Why Layer 1 is Primary:**
- Layer 1 prevents any reprocessing at the source
- Layers 2 & 3 are safety nets
- No duplicate CVs in database guaranteed

---

## Data Storage in Qdrant Collections

### **Collection Architecture**

```
job_postings_structured
├─ Job metadata + email subject info
│
cv_documents (Raw CV files)
├─ PDF/DOCX content
│
cv_structured (Parsed CV data)
├─ Standardized CV info + Application link
│
cv_embeddings (32 vector chunks)
├─ Semantic embeddings for matching
```

### **1. job_postings_structured Collection**

**When Created:** When HR posts a new job

**Payload Structure:**
```json
{
  "id": "342cab3f-fbb4-44b0-bea5-b0cd49f34410",
  "jd_id": "original-jd-uuid",
  "public_token": "hAhBJ9wrAC-UcKJkUjSLTerT8CG0KmKftcYTpWC8V1M",
  "created_date": "2025-10-20T12:40:43.534215",
  "is_active": true,
  "data_type": "ui_display",
  "posted_by_user": "omar-syed",
  "posted_by_role": "admin",
  
  "email_subject_id": "MD-2025-001",
  "email_subject_template": "Mobile Developer | MD-2025-001",
  
  "structured_info": {
    "job_title": "Mobile Developer",
    "job_location": "abu dhabi",
    "job_summary": "As a Mobile Developer...",
    "key_responsibilities": "...",
    "qualifications": "..."
  }
}
```

**Key Fields:**
- `email_subject_id`: Unique identifier for email matching (e.g., "MD-2025-001")
- `email_subject_template`: Full subject candidates should use (e.g., "Mobile Developer | MD-2025-001")
- `public_token`: Anonymous access token for job posting page
- `is_active`: Whether job accepts applications

**Vector:** Dummy vector `[0.0] * 768` (not used for matching)

### **2. cv_documents Collection**

**When Created:** When CV is extracted from email

**Payload Structure:**
```json
{
  "id": "5e7432d6-e025-420c-ac79-0f75b25b6757",
  "type": "cv",
  "filename": "Selected Candidate - Anvesh Kumar.pdf",
  "mime_type": "application/pdf",
  "raw_text": "Full extracted text from PDF...",
  "upload_date": "2025-10-20T12:52:50.777741",
  "file_path": "s3://bucket/5e7432d6.../cv.pdf",
  "source": "email_application",
  "email_id": "AAMkAGQ3ZTk2..."
}
```

**Key Fields:**
- `raw_text`: Complete parsed text from CV
- `file_path`: S3 storage location
- `source`: Always "email_application" for email CVs
- `email_id`: Original email ID (for tracking)

**Vector:** Dummy vector `[0.0] * 768`

### **3. cv_structured Collection**

**When Created:** After CV processing (standardization)

**Payload Structure:**
```json
{
  "id": "5e7432d6-e025-420c-ac79-0f75b25b6757",
  "name": "Anvesh Kumar M",
  "email": "syedfaizanuddin143@gmail.com",
  "phone": "+91 9876543210",
  "document_type": "cv",
  
  "is_job_application": true,
  "job_posting_id": "c53cc4c9-4a3d-49cb-9fe6-47e525f7b2fc",
  "job_title": "Data Reporting Analyst Consultancy",
  "subject_id": "DRA-2025-001",
  
  "cv_filename": "Selected Candidate - Anvesh Kumar.pdf",
  "source": "email_application",
  "email_id": "AAMkAGQ3ZTk2...",
  
  "application_id": "e247c34b-c1a4-416b-bc3c-e412d7925e77",
  "application_status": "submitted",
  "submitted_at": "2025-10-20T12:52:50.777741",
  
  "match_percentage": 0,
  "match_analysis": {},
  "requires_manual_matching": true,
  
  "contact_info": {
    "email": "syedfaizanuddin@gmail.com",
    "phone": "+91 9876543210"
  },
  
  "work_experience": [...],
  "education": [...],
  "skills": [...],
  "certifications": [...]
}
```

**Key Fields:**
- `is_job_application`: Always `true` for email CVs
- `job_posting_id`: Links to job in `job_postings_structured`
- `subject_id`: Email subject ID that matched the job
- `application_id`: Unique application identifier
- `match_percentage`: Always `0` (no automatic matching)
- `requires_manual_matching`: Always `true` (HR does matching manually)
- `source`: Always "email_application"

**Vector:** Dummy vector `[0.0] * 768`

### **4. cv_embeddings Collection**

**When Created:** After embedding generation

**Multiple Points Per CV:** 32 vector chunks (one for each CV section)

**Payload Structure (per chunk):**
```json
{
  "id": "5e7432d6-e025-420c-ac79-0f75b25b6757",
  "type": "cv",
  "chunk_index": 0,
  "section": "summary",
  "text": "Chunk text content..."
}
```

**Vector:** Actual 768-dimensional embedding vector

**32 Sections:**
1. summary, name, contact_info, skills
2. work_experience (multiple entries)
3. education (multiple entries)
4. certifications, languages, etc.

---

## Complete Workflow

### **Phase 1: Job Posting Creation**

```
HR Posts Job → CareersPage.tsx
    ↓
API: POST /api/careers/admin/jobs/unified-update
    ↓
Generate Subject ID → generate_email_subject_id("Mobile Developer")
    ↓ 
Result: "MD-2025-001"
    ↓
Generate Template → generate_email_subject_template(...)
    ↓
Result: "Mobile Developer | MD-2025-001"
    ↓
Store in Qdrant → job_postings_structured
    {
      email_subject_id: "MD-2025-001",
      email_subject_template: "Mobile Developer | MD-2025-001"
    }
    ↓
Display in UI → Copy button for subject template
```

**Files Involved:**
- `careers_routes.py` (lines 1397-1410)
- `qdrant_utils.py` (lines 715-764)
- `CareersPage.tsx` (lines 442-480)

### **Phase 2: Email Scheduler Startup**

```
Backend Starts → main.py lifespan
    ↓
Initialize Email Scheduler
    ↓
Load processed_emails.json → Set of processed email IDs
    ↓
Start Background Task → asyncio.create_task(start_scheduler)
    ↓
Log: "Email scheduler started (checking every 5 minutes)"
```

**Files Involved:**
- `main.py` (lines 99-105)
- `email_scheduler.py` (lines 70-97)

### **Phase 3: Email Processing (Every 5 Minutes)**

```
Timer Triggers (5 min) → email_scheduler.py
    ↓
Get Azure Token → azure_email_service.py
    ↓
Query Unread Emails → Microsoft Graph API
    Filter: isRead=false AND hasAttachments=true
    ↓
Check Each Email → Is email_id in processed_emails.json?
    ├─ YES → Skip
    └─ NO → Continue
    ↓
Parse Email Subject → "Mobile Developer | MD-2025-001"
    ├─ Extract job_title: "Mobile Developer"
    └─ Extract subject_id: "MD-2025-001"
    ↓
Find Job Posting → Search job_postings_structured
    WHERE email_subject_id = "MD-2025-001"
    ↓
Found Job → job_posting_id: "342cab3f..."
    ↓
Download CV Attachments → .pdf, .docx, .doc, .txt only
    ↓
Save to S3 → s3://bucket/application_id/cv.pdf
    ↓
Parse CV → parsing_service.py
    Extract text, tables, PII
    ↓
Standardize CV → llm_service.py
    Generate structured JSON from raw text
    ↓
Generate Embeddings → embedding_service.py
    Create 32 vector chunks (768-dim each)
    ↓
Store CV Documents → cv_documents
    { raw_text, file_path, email_id, source: "email_application" }
    ↓
Store CV Structured → cv_structured
    {
      name, email, phone, work_experience, education,
      is_job_application: true,
      job_posting_id: "342cab3f...",
      subject_id: "MD-2025-001",
      match_percentage: 0,
      requires_manual_matching: true
    }
    ↓
Store CV Embeddings → cv_embeddings (32 points)
    { chunk_index, section, vector[768] }
    ↓
Link Application → link_application_to_job()
    Update cv_structured with application metadata
    ↓
Add to Processed List → processed_emails.json
    ["AAMkAGQ3ZTk2...", ...]
    ↓
Save File → Persist to disk
    ↓
Log Success → "Processed 1 CV from email"
```

**Files Involved:**
- `email_scheduler.py` (lines 104-136)
- `azure_email_service.py` (lines 95-411)
- `email_cv_processor.py` (lines 84-242)
- `qdrant_utils.py` (lines 1118-1177)

### **Phase 4: HR Views Application**

```
HR Opens Careers Page → CareersPage.tsx
    ↓
Click Job Posting → View applicants
    ↓
API: GET /api/careers/admin/jobs/{job_id}/applicants
    ↓
Query cv_structured → WHERE job_posting_id = job_id
    ↓
Return Applications →
    [
      {
        name: "Anvesh Kumar M",
        email: "syedfaizanuddin143@gmail.com",
        match_percentage: 0,
        requires_manual_matching: true,
        cv_filename: "Selected Candidate - Anvesh Kumar.pdf"
      }
    ]
    ↓
HR Clicks "Match" → Manually run matching algorithm
    ↓
View Match Results → See 93.5% match score, etc.
```

---

## Email Filtering Rules

### **Emails That WILL Be Processed:**

**Unread emails** with attachments
**Subject matches pattern:** `Job Title | ID-YYYY-NNN`
**Attachments:** `.pdf`, `.docx`, `.doc`, `.txt`
**Not in processed list:** Email ID not in `processed_emails.json`
**Job posting exists:** Subject ID matches active job
**Sent to:** `cv@alphadatarecruitment.ae`

### **Emails That WILL NOT Be Processed:**

**Already processed** (email ID in tracking file)
**No attachments**
**Invalid subject format** (missing "|" or ID pattern)
**Wrong file types** (e.g., .jpg, .png, .zip)
**Job posting not found** (subject ID doesn't match any job)
**Read emails** (if marked as read in Azure)

### **What Happens to Invalid Emails:**

1. Email is still marked as processed (added to `processed_emails.json`)
2. Warning is logged with reason
3. Email is NOT retried (prevents infinite loops)
4. HR can manually review email and re-submit CV via UI

---

## Configuration

### **Environment Variables (.env)**

```bash
# Azure App Registration
AZURE_CLIENT_ID=your-client-id-here
AZURE_CLIENT_SECRET=your-client-secret-here
AZURE_TENANT_ID=7f33892e-0ae6-495e-93f1-0225bb7095c8
AZURE_MAILBOX_EMAIL=cv@alphadatarecruitment.ae

# Email Scheduler Settings
EMAIL_CHECK_INTERVAL_MINUTES=5    # How often to check emails
EMAIL_MAX_BATCH_SIZE=50           # Max emails to process per check

# Microsoft Graph API
# Automatically configured:
# - Auth URL: https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
# - Graph URL: https://graph.microsoft.com/v1.0
# - Scope: https://graph.microsoft.com/.default
```

### **Azure Permissions Required**

**Microsoft Graph API Permissions:**
- `Mail.Read` - Read mail from mailbox
- `Mail.ReadWrite` - Mark emails as read (optional)
- `User.Read.All` - Access mailbox user info

**Grant Type:** Client Credentials (Application permissions)

### **Data Persistence**

**Docker Volume Mounts:**
```yaml
volumes:
  - ./data:/data  # Stores processed_emails.json
```

**File Locations:**
- Processed emails: `/data/processed_emails.json`
- Email stats: `/data/email_processing_stats.json`
- CV files: S3 bucket (configured via `s3_storage.py`)

### **Monitoring & Logs**

**Log Messages:**
- `Starting scheduled email processing batch`
- `Processed 1 emails successfully`
- `No emails to process`
- `Could not parse email subject: 'invalid subject'`
- `Failed to process email {email_id}: {error}`

**API Endpoints for Monitoring:**
```
GET /api/email/status              # Check scheduler status
GET /api/email/health              # Check Azure connection
POST /api/email/process-emails     # Manually trigger processing
```

---

## Summary

### **Key Points:**

1. **Automated:** System checks emails every 5 minutes automatically
2. **Subject-Based Matching:** Uses unique subject ID to link CVs to jobs
3. **Triple Duplicate Prevention:** Email ID tracking + API filter + Qdrant deduplication
4. **No Auto-Matching:** CVs are stored with `match_percentage: 0`, HR does manual matching
5. **Complete Audit Trail:** Every email, CV, and application is tracked
6. **Safe & Efficient:** Minimal load, respects API limits, graceful error handling

### **Data Flow:**

```
Job Posted → Subject ID Generated → Stored in job_postings_structured
    ↓
Email Received → Subject Parsed → Job Matched → CV Extracted
    ↓
CV Stored → cv_documents + cv_structured + cv_embeddings
    ↓
Application Linked → cv_structured.job_posting_id = job_id
    ↓
HR Views → Manual Matching → Hire/Reject Decision
```

---

**Last Updated:** October 20, 2025  
**System Version:** 2.0.0  
**Email Integration:** Azure Microsoft Graph API v1.0


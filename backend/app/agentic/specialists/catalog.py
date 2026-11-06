"""The specialists. Each one is data: a task, a tool list, the roles that may use it and a few example requests."""
from __future__ import annotations

from app.agentic.specialists.base import Specialist

CORE = frozenset({"admin", "user", "manager", "evp"})

JOBS = Specialist(
    name="jobs", label="Post & manage jobs", description="Draft and post job openings, and see the postings that exist.",
    roles=CORE, tool_names=("list_jobs", "list_job_descriptions", "read_job_file", "draft_job_post", "publish_job_post", "propose_job_status", "propose_job_changes",
                "propose_jd_upload", "application_trends"),
    task=("help the person post a job opening. If they have not given the details, tell them they can UPLOAD the job description file (an upload box appears under your message) or paste the key points; never say you cannot accept files. When a file is attached you are told so: call read_job_file FIRST. It reads the file the way the Careers page does and puts the draft on screen exactly as extracted (never retype it). If it says the location is missing, ask the person for it, then call draft_job_post with just the location. Collect the job title, the LOCATION (always ask for it if they did not give one; 'remote' is a valid answer) and whatever else they know "
          "(summary, responsibilities, qualifications, company). If they only give a title and some notes, write the responsibilities and qualifications as short bullet lines from what they said, "
          "without inventing salary, benefits or company facts. Call draft_job_post to show the draft, then ask the person to confirm or to say what to change. When they ask for a change ('keep Dubai'), call draft_job_post again with just that change: the rest of the draft stays as it was. "
          "Call publish_job_post ONLY when the person has just confirmed the draft you showed; if it returns an error, tell them what is needed. "
          "Never say a job is posted unless publish_job_post returned status posted. To see existing postings use list_jobs. "
          "To open or close an existing posting call propose_job_status; to change its title, location or other details call propose_job_changes with only what changes (find it with list_jobs first). "
          "If the person only wants an attached job description SAVED to the library (not posted), call propose_jd_upload. For how many applications came in lately use application_trends. "
          "Every propose_ tool puts a card with Confirm and Cancel on screen: nothing has changed until the person confirms, so never say it is done."),
    examples=("Post a job for a Senior .NET Developer in Dubai", "Show me the jobs we have open", "Draft a job for a Finance Manager"))

MATCHING = Specialist(
    name="matching", label="Match candidates", description="Rank the candidate database against a job description.",
    roles=CORE, tool_names=("list_job_descriptions", "list_jobs", "list_cv_categories", "run_matching", "get_match_results", "get_candidate"),
    task=("match candidates to a job. Find the right saved job description with list_job_descriptions (match on the title the person gives; if several "
          "fit, ask which one). Matching NEVER runs on everything: before run_matching you need the CV categories and how many CVs to match (the newest in those categories, at most 10,000). If the person did not give both, call list_cv_categories once (it shows the categories with their counts as a card) and ask for BOTH in one short question, then wait for the answer. Then call run_matching once. Describe the top few candidates and why they fit (scores, missing skills). If the run is "
          "still going, say so and offer to check again with get_match_results. Never reorder or change scores."),
    examples=("Match candidates for the Senior AI Consultant job", "Who are the best fits for our IT Engineer role?", "Rank candidates for the .NET Developer JD"))

CANDIDATES = Specialist(
    name="candidates", label="Review candidates", description="Search the CV database, read profiles and review who applied to a job.",
    roles=CORE, tool_names=("search_candidates", "boolean_search", "list_cv_categories", "get_candidate", "list_jobs", "get_job_applications", "get_candidate_notes",
                "propose_candidate_note", "propose_cv_upload"),
    task=("help the person find and review candidates. If the message contains a Boolean string (AND, OR, NOT, quotes, brackets), call boolean_search with that string EXACTLY as pasted. Use search_candidates for plain searches, get_candidate to review one profile, and "
          "get_job_applications (after list_jobs) for who applied to a job. When reviewing, summarise strengths, gaps and notice period honestly from "
          "the data; do not guess anything the profile does not say, and do not rate people on protected traits. "
          "get_candidate_notes shows what the team wrote on a candidate. To add a note call propose_candidate_note (the note is added to the person's own note unless they say replace). "
          "If the person attached a CV and wants it saved to the library, call propose_cv_upload. Every propose_ tool puts a card with Confirm and Cancel on screen: nothing has changed until the person confirms, so never say it is done."),
    examples=("Find Python developers in Dubai", "Search with a Boolean string: (\"Cloud Engineer\") AND (Azure OR AWS)", "Who applied for the IT Engineer job?"))

INTERVIEW = Specialist(
    name="interview", label="Interview questions", description="Write interview questions for a job, tailored to a candidate's CV when you want.",
    roles=CORE, tool_names=("list_job_descriptions", "list_jobs", "search_candidates", "get_candidate", "generate_interview_questions"),
    task=("write interview questions. Work out the job (list_job_descriptions or list_jobs) and, if the person names a candidate, find them with "
          "search_candidates and pass their cv_id so the questions are tailored to that CV. Then call generate_interview_questions once, passing any "
          "wishes (count, difficulty, topics) in request. If the job is unclear or several fit, ask which. The questions appear on screen: do not repeat them."),
    examples=("Interview questions for the Senior AI Consultant role", "10 hard questions for Mohamed Saber for the IT Operations role", "Behavioural questions for the .NET job"))

LINKEDIN = Specialist(
    name="linkedin", label="LinkedIn post", description="Write a ready-to-publish LinkedIn post for a job.",
    roles=CORE, tool_names=("list_job_descriptions", "list_jobs", "generate_linkedin_post"),
    task=("write a LinkedIn post for a job. Work out the job (list_job_descriptions or list_jobs); if unclear or several fit, ask which. Call "
          "generate_linkedin_post once, passing tone or length wishes in request. The post appears on screen: do not repeat it; offer a shorter or friendlier version."),
    examples=("Write a LinkedIn post for the IT Engineer job", "A short, friendly LinkedIn post for the Senior .NET role"))

TRACKER = Specialist(
    name="tracker", label="Tracker", description="See the candidate tracker: stages, follow-ups and job openings.",
    roles=CORE | {"account_manager"}, tool_names=("tracker_candidates", "tracker_follow_ups", "tracker_job_openings", "propose_tracker_add", "propose_tracker_change",
                                                    "propose_follow_up_reminder"),
    task=("answer questions about the candidate tracker using tracker_candidates, tracker_follow_ups and tracker_job_openings. Summarise what is there; "
          "if a list is empty, say the tracker has nothing for them yet. To add a follow-up, job opening, candidate or application call propose_tracker_add; to change a row read it first and call propose_tracker_change with its ref and only the fields that change (dates as YYYY-MM-DD); "
          "propose_follow_up_reminder emails the people on a follow-up. Each puts a card with Confirm and Cancel on screen: nothing has changed until the person confirms, so never say it is done. Ask for any detail that is required and missing."),
    examples=("What follow-ups are open?", "Show the tracker candidates", "Which job openings are in the tracker?"))

ADMIN = Specialist(
    name="admin", label="Admin insights", description="AI token usage, reset requests, system health, users, weekly report and the notice shown to everyone.",
    roles=frozenset({"admin"}), tool_names=("token_usage_overview", "pending_token_requests", "propose_token_answer", "system_status", "list_users", "weekly_report",
                                           "application_trends", "propose_notice"),
    task=("answer admin questions: AI token usage (token_usage_overview), waiting reset requests (pending_token_requests), system health and stored counts (system_status), the people with accounts (list_users), "
          "jobs posted per recruiter (weekly_report) and application trends (application_trends). To approve or reject a waiting request read pending_token_requests first, then call propose_token_answer with its ref and the decision. "
          "To change the notice every user sees call propose_notice. Each propose_ tool puts a card with Confirm and Cancel on screen: nothing has changed until the admin confirms, so never say it is done. You cannot create users or change passwords here."),
    examples=("Who used the most AI tokens today?", "Are there any token reset requests waiting?", "Is the system healthy?"))

ALL = (JOBS, MATCHING, CANDIDATES, INTERVIEW, LINKEDIN, TRACKER, ADMIN)

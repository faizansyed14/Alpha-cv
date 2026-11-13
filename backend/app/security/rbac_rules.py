"""Fixed facts of the access model, shared by the user-management API, the agents and the startup seeding.

There are two levels of access:
* ``admin``: everything everyone has, plus managing users, the AI agents' usage, monitoring and bug reports.
* every other role: identical access to the whole application. The roles are labels of what the person does, not permissions.
"""

ADMIN_ROLE = "admin"
# Label shown on the Users page, in the order they are offered.
STAFF_ROLES = ("user", "manager", "evp", "account_manager")
ALL_ROLES = (ADMIN_ROLE,) + STAFF_ROLES
ROLE_LABELS = {
    "admin": "Admin",
    "user": "Recruiter",
    "manager": "Recruitment manager",
    "evp": "EVP",
    "account_manager": "Sales manager",
}
# the regular expression the API schemas use to accept a role
ROLE_PATTERN = "^(" + "|".join(ALL_ROLES) + ")$"


# Where a person works. Recruiters, recruitment managers and sales managers belong to one location and see only that location data;
# the EVP and the admin see every location. The location is chosen once, when the login is created.
LOCATIONS = ("Dubai", "Abu Dhabi")
LOCATION_ROLES = ("user", "manager", "account_manager")      # roles that must have a location
ALL_LOCATIONS_ROLES = ("evp", "admin")                       # roles that see every location
# who may create a requirement and change its details (a recruiter works only on their own assigned requirements)
TRACKER_FULL_ROLES = ("account_manager", "manager", "evp", "admin")
# who may change each field of a requirement. Each comment belongs to one role: the sales manager writes the sales manager comments, the
# recruitment manager the recruitment manager comments and the recruiter the recruiter comments. The status is changed by the recruiter and
# the recruitment manager. The EVP and the admin, who oversee everything, may change any field.
REQUIREMENT_FIELD_EDITORS = {
    "requirement_date": TRACKER_FULL_ROLES,
    "position": TRACKER_FULL_ROLES,
    "client": TRACKER_FULL_ROLES,
    "cv_submission_date": TRACKER_FULL_ROLES,
    "job_location": TRACKER_FULL_ROLES,               # where the job is
    "salary": TRACKER_FULL_ROLES,
    "duration": TRACKER_FULL_ROLES,                   # full time, or a number of days / months / years, extendable or not
    "recruiter": TRACKER_FULL_ROLES,                  # who it is assigned to
    "recruitment_manager": TRACKER_FULL_ROLES,        # which recruitment manager it is assigned to
    "sales_manager": TRACKER_FULL_ROLES,              # which sales manager owns it
    "jd": TRACKER_FULL_ROLES,                       # the sales manager and the recruitment manager upload, replace and remove it; a recruiter cannot
    "sales_comments": ("account_manager", "evp", "admin"),
    "rm_comments": ("manager", "evp", "admin"),
    "recruiter_comments": ("user", "evp", "admin"),
    "cvs_submitted": ("user", "manager", "evp", "admin"),   # the day CVs were submitted and how many: the recruiter's numbers, which the recruitment manager may correct
    "status": ("user", "manager", "evp", "admin"),
}

# Selections and joining (the row made when a requirement is closed) is not for recruiters: only these roles see the page, and each of them may
# change every field and delete a row.
SELECTION_ROLES = TRACKER_FULL_ROLES
SELECTION_FIELD_EDITORS = {
    "candidate_name": SELECTION_ROLES,
    "status": SELECTION_ROLES,
    "comments": SELECTION_ROLES,
    "selection_date": SELECTION_ROLES,
}

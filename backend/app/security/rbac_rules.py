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

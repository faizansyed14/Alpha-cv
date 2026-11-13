"""What the database itself guarantees, whatever the application does: a role, MFA mode or location it does not know cannot be stored; the
migration holds the same lists as the models; the storage report is only for PostgreSQL."""
import importlib.util
import os

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel

from app.models.user import OTP_MODES, User
from app.security.auth import hash_password
from app.security.rbac_rules import ALL_ROLES, LOCATION_ROLES, LOCATIONS
from app.services.db_health import storage_report


@pytest.fixture
def session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine, tables=[User.__table__])
    with Session(engine) as s:
        yield s


def make(session, **kw):
    base = dict(username="u", password_hash=hash_password("pw"), role="user", otp_mode="real", location="Dubai", email="u@example.com", is_active=True)
    base.update(kw)
    session.add(User(**base))
    session.commit()


def test_every_valid_combination_is_stored(session):
    n = 0
    for role in ALL_ROLES:
        for mode in OTP_MODES:
            for location in ((None,) + (LOCATIONS if role in LOCATION_ROLES else ())):
                n += 1
                make(session, username=f"u{n}", email=f"u{n}@example.com", role=role, otp_mode=mode, location=location)


@pytest.mark.parametrize("bad", [
    {"role": "superuser"}, {"role": ""}, {"role": "Admin"},                       # a role the application does not know (or one with the wrong capitals)
    {"otp_mode": "sms"}, {"otp_mode": ""},                                      # an MFA mode it does not know
    {"location": "Sharjah"}, {"location": "dubai"}, {"location": ""},            # a place that is not one of the two (or is spelt differently)
    {"role": "evp", "location": "Dubai"}, {"role": "admin", "location": "Abu Dhabi"},     # the roles that see every location have none
])
def test_the_database_refuses_what_the_application_never_writes(session, bad):
    with pytest.raises(IntegrityError):
        make(session, **bad)


def test_the_migration_holds_the_same_lists_as_the_models():
    """Migrations are frozen text, so they carry the lists as literals: this fails when the application's lists change and the migration's do not."""
    path = os.path.join(os.path.dirname(__file__), "..", "migrations", "versions", "0030_integrity_and_storage.py")
    spec = importlib.util.spec_from_file_location("m0030", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert set(module.ROLES) == set(ALL_ROLES)
    assert set(module.LOCATIONS) == set(LOCATIONS) and set(module.LOCATION_ROLES) == set(LOCATION_ROLES)
    # the second-step modes were widened later (migration 0031 replaced the constraint 0030 created, adding the authenticator app)
    later = importlib.util.spec_from_file_location("m0031", os.path.join(os.path.dirname(path), "0031_authenticator_mfa.py"))
    later_module = importlib.util.module_from_spec(later)
    later.loader.exec_module(later_module)
    assert set(later_module.NEW_MODES) == set(OTP_MODES)


def test_the_storage_report_is_postgresql_only():
    engine = create_engine("sqlite://")
    assert storage_report(engine) == {"supported": False, "warnings": []}

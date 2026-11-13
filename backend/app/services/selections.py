"""Making the selections-and-joining row of a closed requirement."""
import uuid
from datetime import datetime
from typing import Optional, Sequence

from sqlalchemy.dialects import postgresql, sqlite
from sqlmodel import Session

from app.models.requirement import Requirement
from app.models.selection import Selection, SelectionRecruiter


def create_for_closed(session: Session, req: Requirement, recruiter_ids: Sequence[str]) -> Optional[Selection]:
    """Make the requirement's selection row, in the caller's transaction (nothing is committed here). A requirement has one row, and the DATABASE
    decides that: ``INSERT ... ON CONFLICT (requirement_id) DO NOTHING`` on the unique column, so two closes at the same instant, from two workers,
    can never make two rows or fail with an error: one inserts, the other does nothing and gets None. A requirement that is reopened and closed
    again keeps its row too, so the candidate and comments already written are kept."""
    now = datetime.utcnow()
    when = req.closed_at or now
    dialect = postgresql if session.get_bind().dialect.name == "postgresql" else sqlite
    row_id = str(uuid.uuid4())
    result = session.execute(
        dialect.insert(Selection.__table__).values(
            id=row_id, requirement_id=req.id, location=req.location, selection_date=when.date(), position=req.position, client=req.client,
            status="offer_pending", sales_manager_id=req.sales_manager_id, manager_id=req.manager_id, updated_by=req.closed_by,
            created_at=now, updated_at=now,
        ).on_conflict_do_nothing(index_elements=["requirement_id"])
    )
    if not result.rowcount:
        return None
    for position, rid in enumerate(dict.fromkeys(recruiter_ids)):
        session.add(SelectionRecruiter(selection_id=row_id, recruiter_id=rid, position=position))
    session.flush()
    return session.get(Selection, row_id)

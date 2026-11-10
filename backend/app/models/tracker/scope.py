"""One set of tracker tables serves both teams: every row has a ``team``. A request works for one team; its session is scoped to it, and
from then on every query on a tracker table is limited to that team and every new row is stamped with it, so a handler cannot read or
change the other team's rows by mistake (an id of the other team is simply not found).

    scope_session(session, "abudhabi")
"""
from __future__ import annotations

from sqlalchemy import event
from sqlalchemy.orm import Session as _Session
from sqlalchemy.orm import with_loader_criteria

KEY = "tracker_team"


def scope_session(session, team: str) -> str:
    session.info[KEY] = team
    return team


def _models():
    from app.models.tracker import models as m

    return (m.TrackerOption, m.TrackerJobOpening, m.TrackerCandidate, m.TrackerApplication, m.TrackerFollowUp)


@event.listens_for(_Session, "do_orm_execute")
def _only_this_team(state) -> None:
    team = state.session.info.get(KEY)
    if not team or state.is_column_load or state.is_relationship_load:
        return
    state.statement = state.statement.options(*[
        with_loader_criteria(model, lambda cls: cls.team == team, include_aliases=True) for model in _models()])


@event.listens_for(_Session, "before_flush")
def _stamp_new_rows(session, _context, _instances) -> None:
    team = session.info.get(KEY)
    if not team:
        return
    tracker = _models()
    for obj in session.new:
        if isinstance(obj, tracker) and getattr(obj, "team", None) is None:
            obj.team = team

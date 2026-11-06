"""Reading and appending the agents' chat history. There is deliberately no update or delete function here (and the
database refuses both): the history is a record."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlmodel import Session, select

from app.models.agent import AgentConversation, AgentConversationHidden, AgentMessage


def create_conversation(session: Session, *, agent: str, username: str, title: str, jd_text: str, jd_source: str,
                        jd_id: Optional[str], jd_title: Optional[str], cv_text: Optional[str] = None, cv_id: Optional[str] = None,
                        cv_title: Optional[str] = None) -> AgentConversation:
    row = AgentConversation(agent=agent, username=username, title=title[:160], jd_text=jd_text, jd_source=jd_source,
                            jd_id=jd_id, jd_title=(jd_title or None), cv_text=(cv_text or None), cv_id=(cv_id or None),
                            cv_title=((cv_title or None) if cv_text else None))
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def get_conversation(session: Session, conversation_id: str, username: str) -> Optional[AgentConversation]:
    """A conversation, but only for the person who started it, and only while they have not removed it from their list."""
    row = session.get(AgentConversation, conversation_id)
    if row is None or row.username != username or is_hidden(session, conversation_id, username):
        return None
    return row


def is_hidden(session: Session, conversation_id: str, username: str) -> bool:
    return session.exec(select(AgentConversationHidden.id).where(AgentConversationHidden.conversation_id == conversation_id,
                                                                  AgentConversationHidden.username == username).limit(1)).first() is not None


def hide_conversation(session: Session, conversation_id: str, username: str) -> bool:
    """Remove a chat from its owner's list. The conversation, its messages and the tokens they used are all kept (the token
    count and the audit record must not depend on what someone chose to hide); only an append-only marker is added."""
    row = session.get(AgentConversation, conversation_id)
    if row is None or row.username != username:
        return False
    if not is_hidden(session, conversation_id, username):
        session.add(AgentConversationHidden(conversation_id=conversation_id, username=username))
        session.commit()
    return True


def message_count(session: Session, conversation_id: str) -> int:
    return int(session.exec(select(func.count()).select_from(AgentMessage).where(AgentMessage.conversation_id == conversation_id)).one())


def append_message(session: Session, conversation_id: str, role: str, content: str, **fields: Any) -> AgentMessage:
    seq = int(session.exec(select(func.coalesce(func.max(AgentMessage.seq), 0)).where(AgentMessage.conversation_id == conversation_id)).one()) + 1
    row = AgentMessage(conversation_id=conversation_id, seq=seq, role=role, content=content, **fields)
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def messages(session: Session, conversation_id: str) -> List[AgentMessage]:
    return list(session.exec(select(AgentMessage).where(AgentMessage.conversation_id == conversation_id).order_by(AgentMessage.seq)).all())


def recent_exchange(session: Session, conversation_id: str, turns: int) -> List[AgentMessage]:
    """The last ``turns`` user/assistant pairs that were actually answered (blocked turns are not shown to the model)."""
    rows = [m for m in messages(session, conversation_id) if m.status == "ok" or m.role == "user"]
    answered: List[AgentMessage] = []
    for i, m in enumerate(rows):
        if m.role == "user" and i + 1 < len(rows) and rows[i + 1].role == "assistant" and rows[i + 1].status == "ok":
            answered.extend([m, rows[i + 1]])
    return answered[-2 * turns:]


def list_conversations(session: Session, agent: str, username: str, limit: int = 50) -> List[Dict[str, Any]]:
    hidden = select(AgentConversationHidden.conversation_id).where(AgentConversationHidden.username == username)
    convs = session.exec(select(AgentConversation).where(AgentConversation.agent == agent, AgentConversation.username == username,
                                                         AgentConversation.id.not_in(hidden))
                         .order_by(AgentConversation.created_at.desc()).limit(limit)).all()
    out: List[Dict[str, Any]] = []
    for c in convs:
        last, n = session.exec(select(func.max(AgentMessage.created_at), func.count()).where(AgentMessage.conversation_id == c.id)).one()
        out.append({"id": c.id, "agent": c.agent, "title": c.title, "jd_title": c.jd_title, "jd_source": c.jd_source, "cv_title": c.cv_title,
                    "created_at": c.created_at, "last_message_at": last or c.created_at, "message_count": int(n or 0)})
    out.sort(key=lambda r: r["last_message_at"], reverse=True)
    return out

"""The AI agents' chat history. APPEND-ONLY: nothing here is ever updated or deleted by the application, and on
PostgreSQL the migration adds triggers that refuse UPDATE and DELETE, so the record of what was asked and answered
(and what each call cost) cannot be altered, even by a bug."""
import uuid
from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy import JSON, Column, Text, UniqueConstraint
from sqlmodel import Field, SQLModel


def _id() -> str:
    return str(uuid.uuid4())


class AgentConversation(SQLModel, table=True):
    __tablename__ = "agent_conversation"

    id: str = Field(default_factory=_id, primary_key=True)
    agent: str = Field(index=True)                      # interview | linkedin
    username: str = Field(index=True)                   # who started it; people only ever see their own
    title: str
    jd_id: Optional[str] = None                         # the library job description it was built from, if any
    jd_title: Optional[str] = None
    jd_source: str = "pasted"                           # library | pasted | uploaded
    jd_text: str = Field(sa_column=Column(Text, nullable=False))   # the job text every answer is grounded in (a snapshot)
    cv_id: Optional[str] = None                         # the candidate CV the questions are tailored to, if one was added
    cv_title: Optional[str] = None                      # the candidate's name or the file name
    cv_text: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))   # contact details masked, capped
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class AgentMessage(SQLModel, table=True):
    __tablename__ = "agent_message"
    __table_args__ = (UniqueConstraint("conversation_id", "seq", name="uq_agent_message_seq"),)

    id: str = Field(default_factory=_id, primary_key=True)
    conversation_id: str = Field(foreign_key="agent_conversation.id", index=True)
    seq: int                                            # 1, 2, 3 ... inside the conversation
    role: str                                           # user | assistant
    content: str = Field(sa_column=Column(Text, nullable=False))
    status: str = "ok"                                  # ok | blocked | error
    blocked_reason: Optional[str] = None                # empty | smalltalk | off_topic | injection | no_jd | rate_limited ...
    meta: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSON))   # the structured answer the page renders
    model: Optional[str] = None
    tokens_in: int = 0
    tokens_out: int = 0
    cost_usd: Optional[float] = None
    latency_ms: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class AgentUsageReset(SQLModel, table=True):
    """An admin zeroing one person's token count for the day. Append-only like the history: the count is always
    'tokens used since the latest of (start of today, the last reset)', so a reset never alters or hides what was spent."""
    __tablename__ = "agent_usage_reset"

    id: str = Field(default_factory=_id, primary_key=True)
    username: str = Field(index=True)                   # whose count was reset
    reset_by: str                                       # the admin
    tokens_cleared: int = 0                             # what they had used at that moment (for the record)
    reset_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class AgentConversationHidden(SQLModel, table=True):
    """A person removing a chat from their own list ("delete" in the interface). The conversation itself is never touched
    (it stays as the record of what was asked, answered and spent); this append-only row only hides it from that person."""
    __tablename__ = "agent_conversation_hidden"

    id: str = Field(default_factory=_id, primary_key=True)
    conversation_id: str = Field(foreign_key="agent_conversation.id", index=True)
    username: str = Field(index=True)
    hidden_at: datetime = Field(default_factory=datetime.utcnow)


class AgentResetRequest(SQLModel, table=True):
    """Someone asking an admin to reset their token count. Append-only; a request is pending until a decision row exists."""
    __tablename__ = "agent_reset_request"

    id: str = Field(default_factory=_id, primary_key=True)
    username: str = Field(index=True)
    reason: str = ""
    requested_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class AgentResetDecision(SQLModel, table=True):
    """An admin's answer to a request (approved: the count was reset, rejected: it was not). One per request, append-only."""
    __tablename__ = "agent_reset_decision"

    id: str = Field(default_factory=_id, primary_key=True)
    request_id: str = Field(foreign_key="agent_reset_request.id", index=True, unique=True)
    decision: str                                       # approved | rejected
    decided_by: str
    decided_at: datetime = Field(default_factory=datetime.utcnow, index=True)

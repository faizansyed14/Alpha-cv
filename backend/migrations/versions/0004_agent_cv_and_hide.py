"""candidate CV on agent conversations, and hiding a chat from its owner's list (append-only)

Revision ID: 0004_agent_cv_hide
Revises: 0003_agent_usage_reset
Create Date: 2026-11-04 16:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


revision: str = '0004_agent_cv_hide'
down_revision: Union[str, None] = '0003_agent_usage_reset'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('agent_conversation', sa.Column('cv_id', sqlmodel.sql.sqltypes.AutoString(), nullable=True))
    op.add_column('agent_conversation', sa.Column('cv_title', sqlmodel.sql.sqltypes.AutoString(), nullable=True))
    op.add_column('agent_conversation', sa.Column('cv_text', sa.Text(), nullable=True))
    op.create_table('agent_conversation_hidden',
    sa.Column('id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('conversation_id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('username', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('hidden_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['conversation_id'], ['agent_conversation.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_agent_conversation_hidden_conversation_id'), 'agent_conversation_hidden', ['conversation_id'], unique=False)
    op.create_index(op.f('ix_agent_conversation_hidden_username'), 'agent_conversation_hidden', ['username'], unique=False)
    if op.get_bind().dialect.name == "postgresql":      # the function was created by 0002
        op.execute("CREATE TRIGGER agent_conversation_hidden_append_only BEFORE UPDATE OR DELETE ON agent_conversation_hidden "
                   "FOR EACH ROW EXECUTE FUNCTION agent_history_is_append_only()")


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP TRIGGER IF EXISTS agent_conversation_hidden_append_only ON agent_conversation_hidden")
    op.drop_index(op.f('ix_agent_conversation_hidden_username'), table_name='agent_conversation_hidden')
    op.drop_index(op.f('ix_agent_conversation_hidden_conversation_id'), table_name='agent_conversation_hidden')
    op.drop_table('agent_conversation_hidden')
    op.drop_column('agent_conversation', 'cv_text')
    op.drop_column('agent_conversation', 'cv_title')
    op.drop_column('agent_conversation', 'cv_id')

"""agent token usage resets (append-only)

Revision ID: 0003_agent_usage_reset
Revises: 0002_agents
Create Date: 2026-11-04 14:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


revision: str = '0003_agent_usage_reset'
down_revision: Union[str, None] = '0002_agents'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('agent_usage_reset',
    sa.Column('id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('username', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('reset_by', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('tokens_cleared', sa.Integer(), nullable=False),
    sa.Column('reset_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_agent_usage_reset_username'), 'agent_usage_reset', ['username'], unique=False)
    op.create_index(op.f('ix_agent_usage_reset_reset_at'), 'agent_usage_reset', ['reset_at'], unique=False)
    if op.get_bind().dialect.name == "postgresql":      # the function was created by 0002
        op.execute("CREATE TRIGGER agent_usage_reset_append_only BEFORE UPDATE OR DELETE ON agent_usage_reset "
                   "FOR EACH ROW EXECUTE FUNCTION agent_history_is_append_only()")


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP TRIGGER IF EXISTS agent_usage_reset_append_only ON agent_usage_reset")
    op.drop_index(op.f('ix_agent_usage_reset_reset_at'), table_name='agent_usage_reset')
    op.drop_index(op.f('ix_agent_usage_reset_username'), table_name='agent_usage_reset')
    op.drop_table('agent_usage_reset')

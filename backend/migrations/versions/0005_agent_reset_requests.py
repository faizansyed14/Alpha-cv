"""token reset requests and admin decisions (append-only)

Revision ID: 0005_agent_reset_requests
Revises: 0004_agent_cv_hide
Create Date: 2026-11-04 18:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


revision: str = '0005_agent_reset_requests'
down_revision: Union[str, None] = '0004_agent_cv_hide'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("agent_reset_request", "agent_reset_decision")


def upgrade() -> None:
    op.create_table('agent_reset_request',
    sa.Column('id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('username', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('reason', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('requested_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_agent_reset_request_username'), 'agent_reset_request', ['username'], unique=False)
    op.create_index(op.f('ix_agent_reset_request_requested_at'), 'agent_reset_request', ['requested_at'], unique=False)
    op.create_table('agent_reset_decision',
    sa.Column('id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('request_id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('decision', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('decided_by', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('decided_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['request_id'], ['agent_reset_request.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_agent_reset_decision_request_id'), 'agent_reset_decision', ['request_id'], unique=True)
    op.create_index(op.f('ix_agent_reset_decision_decided_at'), 'agent_reset_decision', ['decided_at'], unique=False)
    if op.get_bind().dialect.name == "postgresql":      # the function was created by 0002
        for t in _TABLES:
            op.execute(f"CREATE TRIGGER {t}_append_only BEFORE UPDATE OR DELETE ON {t} "
                       "FOR EACH ROW EXECUTE FUNCTION agent_history_is_append_only()")


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        for t in _TABLES:
            op.execute(f"DROP TRIGGER IF EXISTS {t}_append_only ON {t}")
    op.drop_index(op.f('ix_agent_reset_decision_decided_at'), table_name='agent_reset_decision')
    op.drop_index(op.f('ix_agent_reset_decision_request_id'), table_name='agent_reset_decision')
    op.drop_table('agent_reset_decision')
    op.drop_index(op.f('ix_agent_reset_request_requested_at'), table_name='agent_reset_request')
    op.drop_index(op.f('ix_agent_reset_request_username'), table_name='agent_reset_request')
    op.drop_table('agent_reset_request')

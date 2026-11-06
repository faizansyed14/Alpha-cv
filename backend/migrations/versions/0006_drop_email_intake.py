"""remove the email-intake tables (processed_emails, email_processing_stats)

Revision ID: 0006_drop_email_intake
Revises: 0005_agent_reset_requests
Create Date: 2026-11-05 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


revision: str = '0006_drop_email_intake'
down_revision: Union[str, None] = '0005_agent_reset_requests'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DROP TABLE IF EXISTS processed_emails")
    op.execute("DROP TABLE IF EXISTS email_processing_stats")


def downgrade() -> None:
    op.create_table('email_processing_stats',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('total_processed', sa.Integer(), server_default='0', nullable=False),
    sa.Column('successful_today', sa.Integer(), server_default='0', nullable=False),
    sa.Column('failed_today', sa.Integer(), server_default='0', nullable=False),
    sa.Column('last_successful_run', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_error', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('processed_emails',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('email_id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('processed_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('email_id')
    )

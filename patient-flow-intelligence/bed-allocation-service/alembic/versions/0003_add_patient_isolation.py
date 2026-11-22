"""Add isolation requirement to patients."""

from alembic import op
import sqlalchemy as sa

revision = "0003_add_patient_isolation"
down_revision = "0002_anglicize_alloc_suggestions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "patients",
        sa.Column("isolation", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("patients", "isolation")

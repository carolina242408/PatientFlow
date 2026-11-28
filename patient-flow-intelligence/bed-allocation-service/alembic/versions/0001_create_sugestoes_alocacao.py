"""Create suggestion table."""

from alembic import op
import sqlalchemy as sa

revision = "0001_create_sugestoes_alocacao"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sugestoes_alocacao",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("encounter_id", sa.Uuid(), nullable=False),
        sa.Column("bed_id", sa.Uuid(), nullable=False),
        sa.Column("score", sa.Double(), nullable=True),
        sa.Column("justification", sa.Text(), nullable=True),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("status IN ('PENDENTE','ACEITE','REJEITADA')"),
    )


def downgrade() -> None:
    op.drop_table("sugestoes_alocacao")


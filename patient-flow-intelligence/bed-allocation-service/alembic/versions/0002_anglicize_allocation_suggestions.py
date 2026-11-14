"""Rename allocation suggestions and harden open allocations."""

from alembic import op

revision = "0002_anglicize_alloc_suggestions"
down_revision = "0001_create_sugestoes_alocacao"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.rename_table("sugestoes_alocacao", "allocation_suggestions")
    op.execute(
        """
        DO $$
        DECLARE constraint_name text;
        BEGIN
          FOR constraint_name IN
            SELECT conname
            FROM pg_constraint
            WHERE conrelid = 'public.allocation_suggestions'::regclass
              AND contype = 'c'
          LOOP
            EXECUTE format(
              'ALTER TABLE public.allocation_suggestions DROP CONSTRAINT %I',
              constraint_name
            );
          END LOOP;
        END
        $$;
        """
    )
    op.execute(
        """
        UPDATE allocation_suggestions
        SET status = CASE status
          WHEN 'PENDENTE' THEN 'PENDING'
          WHEN 'ACEITE' THEN 'ACCEPTED'
          WHEN 'REJEITADA' THEN 'REJECTED'
          ELSE status
        END
        """
    )
    op.create_check_constraint(
        "ck_allocation_suggestions_status",
        "allocation_suggestions",
        "status IN ('PENDING','ACCEPTED','REJECTED')",
    )
    op.execute(
        """
        DO $$
        BEGIN
          IF to_regclass('public.uq_open_alloc_per_bed') IS NULL
             AND to_regclass('public.uq_open_allocation_bed') IS NOT NULL THEN
            ALTER INDEX public.uq_open_allocation_bed RENAME TO uq_open_alloc_per_bed;
          ELSIF to_regclass('public.uq_open_alloc_per_bed') IS NULL THEN
            CREATE UNIQUE INDEX uq_open_alloc_per_bed
              ON public.location_allocations (bed_id)
              WHERE discharged_at IS NULL;
          END IF;
          IF to_regclass('public.uq_open_alloc_per_encounter') IS NULL
             AND to_regclass('public.uq_open_allocation_encounter') IS NOT NULL THEN
            ALTER INDEX public.uq_open_allocation_encounter
              RENAME TO uq_open_alloc_per_encounter;
          ELSIF to_regclass('public.uq_open_alloc_per_encounter') IS NULL THEN
            CREATE UNIQUE INDEX uq_open_alloc_per_encounter
              ON public.location_allocations (encounter_id)
              WHERE discharged_at IS NULL;
          END IF;
        END
        $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
          IF to_regclass('public.uq_open_alloc_per_encounter') IS NOT NULL
             AND to_regclass('public.uq_open_allocation_encounter') IS NULL THEN
            ALTER INDEX public.uq_open_alloc_per_encounter
              RENAME TO uq_open_allocation_encounter;
          END IF;
          IF to_regclass('public.uq_open_alloc_per_bed') IS NOT NULL
             AND to_regclass('public.uq_open_allocation_bed') IS NULL THEN
            ALTER INDEX public.uq_open_alloc_per_bed RENAME TO uq_open_allocation_bed;
          END IF;
        END
        $$;
        """
    )
    op.execute(
        """
        DO $$
        DECLARE constraint_name text;
        BEGIN
          FOR constraint_name IN
            SELECT conname
            FROM pg_constraint
            WHERE conrelid = 'public.allocation_suggestions'::regclass
              AND contype = 'c'
          LOOP
            EXECUTE format(
              'ALTER TABLE public.allocation_suggestions DROP CONSTRAINT %I',
              constraint_name
            );
          END LOOP;
        END
        $$;
        """
    )
    op.execute(
        """
        UPDATE allocation_suggestions
        SET status = CASE status
          WHEN 'PENDING' THEN 'PENDENTE'
          WHEN 'ACCEPTED' THEN 'ACEITE'
          WHEN 'REJECTED' THEN 'REJEITADA'
          ELSE status
        END
        """
    )
    op.create_check_constraint(
        "ck_sugestoes_alocacao_status",
        "allocation_suggestions",
        "status IN ('PENDENTE','ACEITE','REJEITADA')",
    )
    op.rename_table("allocation_suggestions", "sugestoes_alocacao")

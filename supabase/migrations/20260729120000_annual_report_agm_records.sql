-- Structured annual-general-meeting evidence used to generate the AGM
-- protocol that accompanies an annual-report package.  Keep this separate
-- from annual_report_versions: the board signs the annual report before the
-- AGM, while the protocol records decisions made afterwards.

CREATE TABLE public.annual_report_agm_records (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  fiscal_period_id         uuid NOT NULL REFERENCES public.fiscal_periods(id) ON DELETE RESTRICT,
  annual_report_version_id uuid NOT NULL REFERENCES public.annual_report_versions(id) ON DELETE RESTRICT,
  user_id                  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  meeting_date             date NOT NULL,
  meeting_city             text NOT NULL CHECK (length(trim(meeting_city)) BETWEEN 1 AND 100),
  attendees                jsonb NOT NULL CHECK (
    jsonb_typeof(attendees) = 'array' AND jsonb_array_length(attendees) > 0
  ),
  chair_name               text NOT NULL CHECK (length(trim(chair_name)) BETWEEN 1 AND 200),
  minutes_keeper_name      text NOT NULL CHECK (length(trim(minutes_keeper_name)) BETWEEN 1 AND 200),
  adjuster_name            text NOT NULL CHECK (length(trim(adjuster_name)) BETWEEN 1 AND 200),
  board_members            text[] NOT NULL CHECK (cardinality(board_members) > 0),
  board_alternates         text[] NOT NULL DEFAULT '{}'::text[],
  board_fee_resolution     text NOT NULL CHECK (length(trim(board_fee_resolution)) BETWEEN 1 AND 1000),
  other_matters            text CHECK (other_matters IS NULL OR length(other_matters) <= 2000),
  convened_correctly       boolean NOT NULL DEFAULT false,
  statements_adopted       boolean NOT NULL DEFAULT false,
  discharge_granted        boolean NOT NULL DEFAULT false,
  finalized_at             timestamptz,
  finalized_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT annual_report_agm_records_period_unique UNIQUE (company_id, fiscal_period_id),
  CONSTRAINT annual_report_agm_records_finalized_consistency CHECK (
    (finalized_at IS NULL AND finalized_by IS NULL)
    OR (finalized_at IS NOT NULL AND finalized_by IS NOT NULL)
  )
);

CREATE INDEX annual_report_agm_records_version_idx
  ON public.annual_report_agm_records (annual_report_version_id);

ALTER TABLE public.annual_report_agm_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY annual_report_agm_records_select ON public.annual_report_agm_records
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_members.company_id = annual_report_agm_records.company_id
        AND company_members.user_id = auth.uid()
    )
  );

CREATE POLICY annual_report_agm_records_insert ON public.annual_report_agm_records
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_members.company_id = annual_report_agm_records.company_id
        AND company_members.user_id = auth.uid()
        AND company_members.role IN ('owner', 'admin', 'member')
    )
  );

CREATE POLICY annual_report_agm_records_update ON public.annual_report_agm_records
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_members.company_id = annual_report_agm_records.company_id
        AND company_members.user_id = auth.uid()
        AND company_members.role IN ('owner', 'admin', 'member')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_members.company_id = annual_report_agm_records.company_id
        AND company_members.user_id = auth.uid()
        AND company_members.role IN ('owner', 'admin', 'member')
    )
  );

CREATE POLICY annual_report_agm_records_no_delete ON public.annual_report_agm_records
  FOR DELETE USING (false);

CREATE OR REPLACE FUNCTION public.enforce_finalized_agm_record_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.finalized_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot modify a finalized AGM record (id=%)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_agm_record_version_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.annual_report_versions version
    WHERE version.id = NEW.annual_report_version_id
      AND version.company_id = NEW.company_id
      AND version.fiscal_period_id = NEW.fiscal_period_id
      AND version.status IN ('signed', 'filed', 'registered')
  ) THEN
    RAISE EXCEPTION 'AGM record must reference a signed annual-report version for the same company and fiscal period';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER annual_report_agm_records_validate_version
  BEFORE INSERT OR UPDATE ON public.annual_report_agm_records
  FOR EACH ROW EXECUTE FUNCTION public.validate_agm_record_version_link();

CREATE TRIGGER annual_report_agm_records_immutable
  BEFORE UPDATE ON public.annual_report_agm_records
  FOR EACH ROW EXECUTE FUNCTION public.enforce_finalized_agm_record_immutability();

CREATE TRIGGER annual_report_agm_records_updated_at
  BEFORE UPDATE ON public.annual_report_agm_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER audit_annual_report_agm_records
  AFTER INSERT OR UPDATE OR DELETE ON public.annual_report_agm_records
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

NOTIFY pgrst, 'reload schema';

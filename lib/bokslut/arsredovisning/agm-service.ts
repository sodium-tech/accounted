import type { SupabaseClient } from '@supabase/supabase-js'

export interface AnnualMeetingAttendee {
  name: string
  shares: number
  votes: number
}

export interface AnnualMeetingRecord {
  id: string
  company_id: string
  fiscal_period_id: string
  annual_report_version_id: string
  meeting_date: string
  meeting_city: string
  attendees: AnnualMeetingAttendee[]
  chair_name: string
  minutes_keeper_name: string
  adjuster_name: string
  board_members: string[]
  board_alternates: string[]
  board_fee_resolution: string
  other_matters: string | null
  convened_correctly: boolean
  statements_adopted: boolean
  discharge_granted: boolean
  finalized_at: string | null
  created_at: string
  updated_at: string
}

export type AnnualMeetingRecordInput = Omit<
  AnnualMeetingRecord,
  'id' | 'company_id' | 'fiscal_period_id' | 'finalized_at' | 'created_at' | 'updated_at'
>

const COLUMNS =
  'id, company_id, fiscal_period_id, annual_report_version_id, meeting_date, meeting_city, attendees, chair_name, minutes_keeper_name, adjuster_name, board_members, board_alternates, board_fee_resolution, other_matters, convened_correctly, statements_adopted, discharge_granted, finalized_at, created_at, updated_at'

export async function getAnnualMeetingRecord(
  supabase: SupabaseClient,
  companyId: string,
  fiscalPeriodId: string,
): Promise<AnnualMeetingRecord | null> {
  const { data, error } = await supabase
    .from('annual_report_agm_records')
    .select(COLUMNS)
    .eq('company_id', companyId)
    .eq('fiscal_period_id', fiscalPeriodId)
    .maybeSingle()
  if (error) throw new Error(`Failed to load AGM record: ${error.message}`)
  return (data as AnnualMeetingRecord | null) ?? null
}

export async function upsertAnnualMeetingRecord(
  supabase: SupabaseClient,
  companyId: string,
  userId: string,
  fiscalPeriodId: string,
  input: AnnualMeetingRecordInput,
): Promise<AnnualMeetingRecord> {
  const { data, error } = await supabase
    .from('annual_report_agm_records')
    .upsert(
      {
        company_id: companyId,
        fiscal_period_id: fiscalPeriodId,
        user_id: userId,
        ...input,
      },
      { onConflict: 'company_id,fiscal_period_id' },
    )
    .select(COLUMNS)
    .single()
  if (error || !data) {
    throw new Error(`Failed to save AGM record: ${error?.message ?? 'unknown'}`)
  }
  return data as AnnualMeetingRecord
}

export async function finalizeAnnualMeetingRecord(
  supabase: SupabaseClient,
  companyId: string,
  userId: string,
  fiscalPeriodId: string,
): Promise<AnnualMeetingRecord> {
  const { data, error } = await supabase
    .from('annual_report_agm_records')
    .update({ finalized_at: new Date().toISOString(), finalized_by: userId })
    .eq('company_id', companyId)
    .eq('fiscal_period_id', fiscalPeriodId)
    .is('finalized_at', null)
    .eq('convened_correctly', true)
    .eq('statements_adopted', true)
    .select(COLUMNS)
    .maybeSingle()
  if (error) throw new Error(`Failed to finalize AGM record: ${error.message}`)
  if (!data) {
    throw new Error('AGM record is missing, already finalized, or required decisions are not confirmed')
  }
  return data as AnnualMeetingRecord
}

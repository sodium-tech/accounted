import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withRouteContext } from '@/lib/api/with-route-context'
import { errorResponse, errorResponseFromCode } from '@/lib/errors/get-structured-error'
import { validateBody } from '@/lib/api/validate'
import {
  finalizeAnnualMeetingRecord,
  getAnnualMeetingRecord,
  upsertAnnualMeetingRecord,
} from '@/lib/bokslut/arsredovisning/agm-service'

const stripControlChars = (value: string): string =>
  value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')

const text = (max: number) => z.string().trim().min(1).max(max).transform(stripControlChars)
const optionalText = (max: number) =>
  z.string().trim().max(max).transform(stripControlChars).nullable()
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}, 'Invalid calendar date')

const MeetingSchema = z.object({
  annual_report_version_id: z.string().uuid(),
  meeting_date: isoDate,
  meeting_city: text(100),
  attendees: z.array(z.object({
    name: text(200),
    shares: z.number().int().positive().max(2_000_000_000),
    votes: z.number().int().positive().max(2_000_000_000),
  }).strict()).min(1).max(100),
  chair_name: text(200),
  minutes_keeper_name: text(200),
  adjuster_name: text(200),
  board_members: z.array(text(200)).min(1).max(50),
  board_alternates: z.array(text(200)).max(50),
  board_fee_resolution: text(1000),
  other_matters: optionalText(2000),
  convened_correctly: z.boolean(),
  statements_adopted: z.boolean(),
  discharge_granted: z.boolean(),
}).strict()

async function loadPeriodAndShareCount(
  supabase: Parameters<typeof getAnnualMeetingRecord>[0],
  companyId: string,
  fiscalPeriodId: string,
) {
  const [{ data: period }, { data: settings }] = await Promise.all([
    supabase
      .from('fiscal_periods')
      .select('id, period_end')
      .eq('id', fiscalPeriodId)
      .eq('company_id', companyId)
      .maybeSingle(),
    supabase
      .from('company_settings')
      .select('antal_aktier')
      .eq('company_id', companyId)
      .maybeSingle(),
  ])
  return {
    period: period as { id: string; period_end: string } | null,
    shareCount: (settings as { antal_aktier?: number | null } | null)?.antal_aktier ?? null,
  }
}

function meetingValidationResponse(message: string) {
  return NextResponse.json(
    { error: { code: 'ANNUAL_MEETING_INVALID', message } },
    { status: 422 },
  )
}

export const GET = withRouteContext(
  'period.arsredovisning_agm_get',
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const { supabase, companyId, log, requestId } = ctx
    try {
      const { period, shareCount } = await loadPeriodAndShareCount(supabase, companyId, id)
      if (!period) return errorResponseFromCode('PERIOD_NOT_FOUND', log, { requestId })
      const data = await getAnnualMeetingRecord(supabase, companyId, id)
      return NextResponse.json({ data, share_count: shareCount })
    } catch (error) {
      return errorResponse(error, log, { requestId })
    }
  },
)

export const POST = withRouteContext(
  'period.arsredovisning_agm_save',
  async (request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const { supabase, companyId, user, log, requestId } = ctx
    const validation = await validateBody(request, MeetingSchema)
    if (!validation.success) return validation.response
    try {
      const { period, shareCount } = await loadPeriodAndShareCount(supabase, companyId, id)
      if (!period) return errorResponseFromCode('PERIOD_NOT_FOUND', log, { requestId })
      if (validation.data.meeting_date <= period.period_end) {
        return meetingValidationResponse('Årsstämman måste ligga efter räkenskapsårets slut.')
      }
      if (!shareCount) {
        return meetingValidationResponse('Antal registrerade aktier saknas i företagsinställningarna.')
      }
      const representedShares = validation.data.attendees.reduce(
        (sum, attendee) => sum + attendee.shares,
        0,
      )
      if (representedShares > shareCount) {
        return meetingValidationResponse('Röstlängden innehåller fler aktier än bolaget har registrerat.')
      }
      const data = await upsertAnnualMeetingRecord(
        supabase,
        companyId,
        user.id,
        id,
        validation.data,
      )
      return NextResponse.json({ data })
    } catch (error) {
      return errorResponse(error, log, { requestId })
    }
  },
  { requireWrite: true },
)

export const PATCH = withRouteContext(
  'period.arsredovisning_agm_finalize',
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const { supabase, companyId, user, log, requestId } = ctx
    try {
      const [{ period, shareCount }, record] = await Promise.all([
        loadPeriodAndShareCount(supabase, companyId, id),
        getAnnualMeetingRecord(supabase, companyId, id),
      ])
      if (!period) return errorResponseFromCode('PERIOD_NOT_FOUND', log, { requestId })
      if (!record) return meetingValidationResponse('Spara stämmouppgifterna före låsning.')
      if (!shareCount) {
        return meetingValidationResponse('Antal registrerade aktier saknas i företagsinställningarna.')
      }
      const representedShares = record.attendees.reduce(
        (sum, attendee) => sum + attendee.shares,
        0,
      )
      if (representedShares !== shareCount) {
        return meetingValidationResponse(
          `Röstlängden omfattar ${representedShares} av bolagets ${shareCount} aktier. Kontrollera närvaro eller komplettera protokollet innan det låses.`,
        )
      }
      const data = await finalizeAnnualMeetingRecord(supabase, companyId, user.id, id)
      return NextResponse.json({ data })
    } catch (error) {
      return errorResponse(error, log, { requestId })
    }
  },
  { requireWrite: true },
)

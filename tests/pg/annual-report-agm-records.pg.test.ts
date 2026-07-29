import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { getPool, withUserContext } from './setup'
import { insertAuthUser, seedCompany } from './fixtures'

async function insertSignedVersion(companyId: string, fiscalPeriodId: string, userId: string) {
  const id = randomUUID()
  await getPool().query(
    `INSERT INTO public.annual_report_versions
       (id, company_id, fiscal_period_id, user_id, version_number, schema_version,
        framework, status, report_data, content_hash, finalized_at, finalized_by)
     VALUES ($1, $2, $3, $4, 1, '1', 'k2', 'signed', '{}'::jsonb,
             repeat('a', 64), now(), $4)`,
    [id, companyId, fiscalPeriodId, userId],
  )
  return id
}

async function insertMeeting(params: {
  companyId: string
  fiscalPeriodId: string
  userId: string
  versionId: string
}) {
  const id = randomUUID()
  await getPool().query(
    `INSERT INTO public.annual_report_agm_records
       (id, company_id, fiscal_period_id, annual_report_version_id, user_id,
        meeting_date, meeting_city, attendees, chair_name, minutes_keeper_name,
        adjuster_name, board_members, board_fee_resolution, convened_correctly,
        statements_adopted, discharge_granted)
     VALUES ($1, $2, $3, $4, $5, '2027-06-01', 'Stockholm',
             '[{"name":"Test Owner","shares":250,"votes":250}]'::jsonb,
             'Test Owner', 'Test Owner', 'Test Owner', ARRAY['Test Owner'],
             'Inget arvode', true, true, true)`,
    [id, params.companyId, params.fiscalPeriodId, params.versionId, params.userId],
  )
  return id
}

describe('annual_report_agm_records', () => {
  it('only accepts a signed version from the same company and period', async () => {
    const first = await seedCompany()
    const second = await seedCompany()
    const foreignVersion = await insertSignedVersion(
      second.companyId,
      second.fiscalPeriodId,
      second.userId,
    )

    await expect(insertMeeting({ ...first, versionId: foreignVersion })).rejects.toThrow(
      /same company and fiscal period/i,
    )
  })

  it('is RLS-isolated and cannot be deleted through the API role', async () => {
    const owner = await seedCompany()
    const versionId = await insertSignedVersion(
      owner.companyId,
      owner.fiscalPeriodId,
      owner.userId,
    )
    const meetingId = await insertMeeting({ ...owner, versionId })
    const stranger = await insertAuthUser()

    const hidden = await withUserContext(stranger, (client) =>
      client.query('SELECT id FROM public.annual_report_agm_records WHERE id = $1', [meetingId]),
    )
    expect(hidden.rows).toHaveLength(0)

    const deleted = await withUserContext(owner.userId, (client) =>
      client.query('DELETE FROM public.annual_report_agm_records WHERE id = $1 RETURNING id', [meetingId]),
    )
    expect(deleted.rows).toHaveLength(0)
  })

  it('permits finalization once and then makes the record immutable', async () => {
    const owner = await seedCompany()
    const versionId = await insertSignedVersion(
      owner.companyId,
      owner.fiscalPeriodId,
      owner.userId,
    )
    const meetingId = await insertMeeting({ ...owner, versionId })

    await getPool().query(
      `UPDATE public.annual_report_agm_records
       SET finalized_at = now(), finalized_by = $2
       WHERE id = $1`,
      [meetingId, owner.userId],
    )
    await expect(
      getPool().query(
        `UPDATE public.annual_report_agm_records SET meeting_city = 'Göteborg' WHERE id = $1`,
        [meetingId],
      ),
    ).rejects.toThrow(/Cannot modify a finalized AGM record/i)
  })
})

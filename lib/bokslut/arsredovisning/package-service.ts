import { createHash } from 'node:crypto'
import { renderToBuffer } from '@react-pdf/renderer'
import JSZip from 'jszip'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ArsredovisningPDF } from './arsredovisning-pdf'
import { ArsredovisningK3PDF } from './arsredovisning-k3-pdf'
import { AnnualMeetingProtocolPDF } from './agm-protocol-pdf'
import { getAnnualMeetingRecord } from './agm-service'
import { getAnnualReportVersion } from './version-service'
import { getVersionIxbrlInput } from './version-ixbrl'
import { generateK2IxbrlDocument } from '@/lib/bokslut/ixbrl/document/k2-document'
import type { ArsredovisningData } from './types'

const ARCHIVABLE_VERSION_STATUSES = new Set(['signed', 'filed', 'registered'])

function sha256(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex')
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_')
}

async function loadSignedVersionReport(
  supabase: SupabaseClient,
  companyId: string,
  fiscalPeriodId: string,
  versionId: string,
) {
  const version = await getAnnualReportVersion(supabase, companyId, fiscalPeriodId, versionId)
  if (!version) throw new Error('Annual-report version not found')
  if (!ARCHIVABLE_VERSION_STATUSES.has(version.summary.status)) {
    throw new Error('Annual-report package requires a signed version')
  }

  const { data: signatureRows, error: signatureError } = await supabase
    .from('arsredovisning_signature_requests')
    .select('role, signer_name, signed_at, status, evidence_reference, signing_method')
    .eq('company_id', companyId)
    .eq('fiscal_period_id', fiscalPeriodId)
    .eq('annual_report_version_id', versionId)
    .eq('status', 'signed')
    .order('created_at', { ascending: true })
  if (signatureError) {
    throw new Error(`Failed to load version signatures: ${signatureError.message}`)
  }
  if (!signatureRows || signatureRows.length === 0) {
    throw new Error('Annual-report package requires signature evidence')
  }

  const report = structuredClone(version.report_data) as ArsredovisningData
  report.signatures = signatureRows.map((signature) => ({
    role: signature.role,
    name: signature.signer_name,
    signed_at: signature.signed_at,
  }))
  return { version, report, signatureRows }
}

export async function buildAnnualMeetingProtocol(
  supabase: SupabaseClient,
  companyId: string,
  fiscalPeriodId: string,
  versionId: string,
): Promise<{ bytes: Uint8Array; filename: string }> {
  const [{ report }, meeting] = await Promise.all([
    loadSignedVersionReport(supabase, companyId, fiscalPeriodId, versionId),
    getAnnualMeetingRecord(supabase, companyId, fiscalPeriodId),
  ])
  if (!meeting || meeting.finalized_at === null) {
    throw new Error('A finalized AGM record is required to generate the protocol')
  }
  if (meeting.annual_report_version_id !== versionId) {
    throw new Error('The finalized AGM record belongs to another annual-report version')
  }
  const buffer = await renderToBuffer(AnnualMeetingProtocolPDF({ report, meeting }))
  return {
    bytes: new Uint8Array(buffer),
    filename: `arsstammoprotokoll-${safeSegment(report.fiscal_period.period_end)}.pdf`,
  }
}

export async function buildAnnualReportPackage(
  supabase: SupabaseClient,
  companyId: string,
  fiscalPeriodId: string,
  versionId: string,
): Promise<{ bytes: Uint8Array; filename: string; manifest: Record<string, unknown> }> {
  const [{ version, report, signatureRows }, meeting] = await Promise.all([
    loadSignedVersionReport(supabase, companyId, fiscalPeriodId, versionId),
    getAnnualMeetingRecord(supabase, companyId, fiscalPeriodId),
  ])
  if (!meeting || meeting.finalized_at === null) {
    throw new Error('A finalized AGM record is required to generate the complete package')
  }
  if (meeting.annual_report_version_id !== versionId) {
    throw new Error('The finalized AGM record belongs to another annual-report version')
  }

  const PdfComponent = report.accounting_framework === 'k3'
    ? ArsredovisningK3PDF
    : ArsredovisningPDF
  const annualReportPdf = new Uint8Array(
    await renderToBuffer(PdfComponent({ data: report })),
  )
  const agmProtocolPdf = new Uint8Array(
    await renderToBuffer(AnnualMeetingProtocolPDF({ report, meeting })),
  )
  const ixbrlInput = await getVersionIxbrlInput(
    supabase,
    companyId,
    fiscalPeriodId,
    versionId,
  )
  if (!ixbrlInput) throw new Error('The signed version does not contain iXBRL data')
  const { xhtml, warnings } = generateK2IxbrlDocument(ixbrlInput)

  const validationEvidence = JSON.stringify(
    {
      annual_report_version_id: version.summary.id,
      content_hash: version.summary.content_hash,
      validation: version.validation_summary,
      generator_warnings: warnings,
    },
    null,
    2,
  ) + '\n'
  const signatureEvidence = JSON.stringify(
    signatureRows.map((signature) => ({
      role: signature.role,
      signer_name: signature.signer_name,
      signed_at: signature.signed_at,
      signing_method: signature.signing_method,
      evidence_reference: signature.evidence_reference,
    })),
    null,
    2,
  ) + '\n'

  const files: Record<string, Uint8Array | string> = {
    'annual-report.pdf': annualReportPdf,
    'annual-report.xhtml': xhtml,
    'agm-protocol.pdf': agmProtocolPdf,
    'validation-evidence.json': validationEvidence,
    'signature-evidence.json': signatureEvidence,
  }
  const fileHashes = Object.fromEntries(
    Object.entries(files).map(([name, content]) => [name, sha256(content)]),
  )
  const manifest = {
    schema_version: 'accounted-annual-report-package/1',
    generated_at: new Date().toISOString(),
    company: {
      name: report.company.name,
      org_number: report.company.org_number,
    },
    fiscal_period: report.fiscal_period,
    annual_report_version: {
      id: version.summary.id,
      number: version.summary.version_number,
      status: version.summary.status,
      content_hash: version.summary.content_hash,
      taxonomy_version: version.summary.taxonomy_version,
      entry_point: version.summary.entry_point,
    },
    annual_meeting_record: {
      id: meeting.id,
      meeting_date: meeting.meeting_date,
      finalized_at: meeting.finalized_at,
    },
    files: fileHashes,
  }
  const manifestText = JSON.stringify(manifest, null, 2) + '\n'
  files['manifest.json'] = manifestText
  const checksums = Object.entries(files)
    .map(([name, content]) => `${sha256(content)}  ${name}`)
    .sort()
    .join('\n') + '\n'
  files['SHA256SUMS'] = checksums

  const zip = new JSZip()
  for (const [name, content] of Object.entries(files)) zip.file(name, content)
  const bytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  })
  return {
    bytes,
    filename: `arsredovisningspaket-${safeSegment(report.fiscal_period.period_end)}-v${version.summary.version_number}.zip`,
    manifest,
  }
}

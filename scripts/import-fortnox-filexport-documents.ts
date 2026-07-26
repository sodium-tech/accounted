#!/usr/bin/env npx tsx
/**
 * Attach documents from a Fortnox Filexport to SIE-imported vouchers.
 *
 * Safety properties:
 * - Dry run is the default.
 * - Apply requires --apply and --confirm-company with the exact company UUID.
 * - Only files under Linked files/YYYY/MM/Vouchers are eligible.
 * - Every file must resolve to exactly one SIE-preserved voucher before any
 *   write begins. Ambiguous or missing targets fail the whole plan closed.
 * - Existing (content hash, voucher) pairs are skipped, so reruns are additive
 *   and idempotent.
 * - No update or delete operation is issued.
 *
 * Usage:
 *   npx tsx scripts/import-fortnox-filexport-documents.ts \
 *     --archive-dir /path/to/extracted \
 *     --company-id <uuid> \
 *     --user-id <uuid>
 *
 *   npx tsx scripts/import-fortnox-filexport-documents.ts \
 *     --archive-dir /path/to/extracted \
 *     --company-id <uuid> \
 *     --user-id <uuid> \
 *     --apply --confirm-company <same-company-uuid>
 */

import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, relative, resolve } from 'node:path'
import { config } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  computeSHA256,
  detectFileMagic,
  uploadDocument,
} from '@/lib/core/documents/document-service'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import {
  fortnoxVoucherAssetKey,
  parseFortnoxVoucherAssetPath,
  type FortnoxVoucherAssetRef,
} from '@/lib/import/fortnox-filexport'

config({ path: '.env.local' })

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function requiredArg(name: string): string {
  const value = arg(name)
  if (!value) throw new Error(`Missing --${name}`)
  return value
}

const archiveDirArg = requiredArg('archive-dir')
const companyId = requiredArg('company-id')
const userId = requiredArg('user-id')
const apply = process.argv.includes('--apply')
const confirmedCompanyId = arg('confirm-company')
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
}
if (apply && confirmedCompanyId !== companyId) {
  throw new Error('--apply requires --confirm-company with the exact --company-id value')
}

const archiveDir = resolve(archiveDirArg)
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
}) as SupabaseClient

interface JournalEntryRow {
  id: string
  entry_date: string
  source_voucher_series: string | null
  source_voucher_number: number | null
}

interface AttachmentRow {
  sha256_hash: string
  journal_entry_id: string | null
}

interface PlannedAsset {
  absolutePath: string
  ref: FortnoxVoucherAssetRef
  journalEntryId: string
  sha256: string
  fileName: string
  mimeType: string
  size: number
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
}

async function listFiles(directory: string): Promise<string[]> {
  const result: string[] = []
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) result.push(...await listFiles(path))
    else if (entry.isFile()) result.push(path)
  }
  return result
}

function shortAssetLabel(ref: FortnoxVoucherAssetRef): string {
  return `${ref.fiscalYear}:${ref.sourceVoucherSeries}${ref.sourceVoucherNumber}`
}

async function main(): Promise<void> {
  const archiveStat = await stat(archiveDir)
  if (!archiveStat.isDirectory()) throw new Error('--archive-dir must be a directory')

  const { data: membership, error: membershipError } = await supabase
    .from('company_members')
    .select('company_id, user_id')
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .maybeSingle()
  if (membershipError || !membership) {
    throw new Error('The requested user is not a member of the destination company')
  }

  const [journalEntries, existingAttachments, allFiles] = await Promise.all([
    fetchAllRows<JournalEntryRow>(({ from, to }) =>
      supabase
        .from('journal_entries')
        .select('id, entry_date, source_voucher_series, source_voucher_number')
        .eq('company_id', companyId)
        .eq('status', 'posted')
        .not('source_voucher_series', 'is', null)
        .not('source_voucher_number', 'is', null)
        .order('id', { ascending: true })
        .range(from, to),
    ),
    fetchAllRows<AttachmentRow>(({ from, to }) =>
      supabase
        .from('document_attachments')
        .select('sha256_hash, journal_entry_id')
        .eq('company_id', companyId)
        .order('id', { ascending: true })
        .range(from, to),
    ),
    listFiles(archiveDir),
  ])

  const entryIdsByKey = new Map<string, string[]>()
  for (const entry of journalEntries) {
    if (entry.source_voucher_series == null || entry.source_voucher_number == null) continue
    const key = fortnoxVoucherAssetKey(
      Number(entry.entry_date.slice(0, 4)),
      entry.source_voucher_series,
      entry.source_voucher_number,
    )
    entryIdsByKey.set(key, [...(entryIdsByKey.get(key) ?? []), entry.id])
  }

  const existingPairs = new Set(
    existingAttachments
      .filter((row) => row.journal_entry_id != null)
      .map((row) => `${row.sha256_hash}|${row.journal_entry_id}`),
  )

  const eligible = allFiles.flatMap((absolutePath) => {
    const relativePath = relative(archiveDir, absolutePath).replaceAll('\\', '/')
    const ref = parseFortnoxVoucherAssetPath(relativePath)
    return ref ? [{ absolutePath, ref }] : []
  })

  const unresolved: string[] = []
  const unsupported: string[] = []
  const planned: PlannedAsset[] = []
  let alreadyPresent = 0

  for (const asset of eligible) {
    const key = fortnoxVoucherAssetKey(
      asset.ref.fiscalYear,
      asset.ref.sourceVoucherSeries,
      asset.ref.sourceVoucherNumber,
    )
    const targetIds = entryIdsByKey.get(key) ?? []
    if (targetIds.length !== 1) {
      unresolved.push(`${shortAssetLabel(asset.ref)} targets=${targetIds.length}`)
      continue
    }

    const extension = extname(asset.absolutePath).toLowerCase()
    const declaredMime = MIME_BY_EXTENSION[extension]
    if (!declaredMime) {
      unsupported.push(`${shortAssetLabel(asset.ref)} extension=${extension || '[none]'}`)
      continue
    }

    const bytes = await readFile(asset.absolutePath)
    const sniffedMime = detectFileMagic(new Uint8Array(bytes))
    if (sniffedMime !== declaredMime) {
      unsupported.push(`${shortAssetLabel(asset.ref)} invalid-magic`)
      continue
    }

    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (existingPairs.has(`${sha256}|${targetIds[0]}`)) {
      alreadyPresent++
      continue
    }

    planned.push({
      absolutePath: asset.absolutePath,
      ref: asset.ref,
      journalEntryId: targetIds[0],
      sha256,
      fileName: asset.ref.relativePath.split('/').at(-1) as string,
      mimeType: declaredMime,
      size: bytes.byteLength,
    })
  }

  const plannedBytes = planned.reduce((sum, asset) => sum + asset.size, 0)
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    filesScanned: allFiles.length,
    eligibleVoucherAssets: eligible.length,
    journalEntriesScanned: journalEntries.length,
    plannedUploads: planned.length,
    plannedBytes,
    alreadyPresent,
    unresolved: unresolved.length,
    unsupported: unsupported.length,
  }, null, 2))

  if (unresolved.length > 0 || unsupported.length > 0) {
    console.error('Plan refused: every eligible voucher asset must have one exact target and a valid supported file type.')
    for (const item of unresolved.slice(0, 20)) console.error(`unresolved ${item}`)
    for (const item of unsupported.slice(0, 20)) console.error(`unsupported ${item}`)
    process.exitCode = 2
    return
  }

  if (!apply) {
    console.log('Dry run complete. No destination data was written.')
    return
  }

  let uploaded = 0
  for (const asset of planned) {
    const bytes = await readFile(asset.absolutePath)
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    const verifiedHash = await computeSHA256(arrayBuffer)
    if (verifiedHash !== asset.sha256) {
      throw new Error(`Source asset changed after planning: ${shortAssetLabel(asset.ref)}`)
    }

    await uploadDocument(
      supabase,
      userId,
      companyId,
      { name: asset.fileName, buffer: arrayBuffer, type: asset.mimeType },
      { upload_source: 'api', journal_entry_id: asset.journalEntryId },
    )
    uploaded++
  }

  console.log(JSON.stringify({ uploaded, skippedExisting: alreadyPresent }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

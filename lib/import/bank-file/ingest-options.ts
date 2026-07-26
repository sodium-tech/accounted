import type { IngestOptions } from '@/types'

interface BankFileIngestOptionsInput {
  autoCategorize: boolean
  settlementAccount?: string
  rawInsertOnly: boolean
}

/**
 * Translate the bank-import confirmation choices into ingestion safeguards.
 *
 * The confirmation screen deliberately submits auto_categorize=false. Keep
 * that promise at the ingestion boundary: a staged bank-file import must not
 * create journal entries through mapping rules, including in development and
 * test environments where auto-booking is enabled.
 */
export function buildBankFileIngestOptions({
  autoCategorize,
  settlementAccount,
  rawInsertOnly,
}: BankFileIngestOptionsInput): IngestOptions {
  const options: IngestOptions = {}
  if (!autoCategorize) options.skipAutoCategorization = true
  if (settlementAccount) options.settlementAccount = settlementAccount
  if (rawInsertOnly) options.rawInsertOnly = true
  return options
}

export interface FortnoxVoucherAssetRef {
  relativePath: string
  fiscalYear: number
  month: number
  sourceVoucherSeries: string
  sourceVoucherNumber: number
}

const LINKED_VOUCHER_PATH = /^(?:Linked files|Kopplade filer)\/(\d{4})\/(\d{2})\/(?:Vouchers|Verifikationer)\/([^/]+)$/i
const VOUCHER_FILE_NAME = /^([A-Z]+)(\d+)_/i

/**
 * Parse only Filexport paths that carry an explicit Fortnox voucher series and
 * number. Supplier-invoice and bank-file paths deliberately return null: their
 * numeric prefixes are not guaranteed to be voucher identifiers.
 */
export function parseFortnoxVoucherAssetPath(path: string): FortnoxVoucherAssetRef | null {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '')
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) return null

  const pathMatch = LINKED_VOUCHER_PATH.exec(normalized)
  if (!pathMatch) return null

  const [, yearText, monthText, fileName] = pathMatch
  const fileMatch = VOUCHER_FILE_NAME.exec(fileName)
  if (!fileMatch) return null

  const fiscalYear = Number(yearText)
  const month = Number(monthText)
  const sourceVoucherNumber = Number(fileMatch[2])
  if (!Number.isInteger(fiscalYear) || fiscalYear < 1900 || fiscalYear > 2200) return null
  if (!Number.isInteger(month) || month < 1 || month > 12) return null
  if (!Number.isSafeInteger(sourceVoucherNumber) || sourceVoucherNumber < 1) return null

  return {
    relativePath: normalized,
    fiscalYear,
    month,
    sourceVoucherSeries: fileMatch[1].toUpperCase(),
    sourceVoucherNumber,
  }
}

export function fortnoxVoucherAssetKey(
  fiscalYear: number,
  sourceVoucherSeries: string,
  sourceVoucherNumber: number,
): string {
  return `${fiscalYear}|${sourceVoucherSeries.toUpperCase()}|${sourceVoucherNumber}`
}

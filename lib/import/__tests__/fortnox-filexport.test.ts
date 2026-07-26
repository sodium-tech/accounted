import { describe, expect, it } from 'vitest'
import {
  fortnoxVoucherAssetKey,
  parseFortnoxVoucherAssetPath,
} from '../fortnox-filexport'

describe('parseFortnoxVoucherAssetPath', () => {
  it('parses an English Filexport voucher path', () => {
    expect(
      parseFortnoxVoucherAssetPath('Linked files/2025/08/Vouchers/A64_123_receipt.pdf'),
    ).toEqual({
      relativePath: 'Linked files/2025/08/Vouchers/A64_123_receipt.pdf',
      fiscalYear: 2025,
      month: 8,
      sourceVoucherSeries: 'A',
      sourceVoucherNumber: 64,
    })
  })

  it('parses a Swedish Filexport voucher path and Windows separators', () => {
    expect(
      parseFortnoxVoucherAssetPath('Kopplade filer\\2026\\01\\Verifikationer\\l3_99_lon.pdf'),
    ).toMatchObject({
      fiscalYear: 2026,
      month: 1,
      sourceVoucherSeries: 'L',
      sourceVoucherNumber: 3,
    })
  })

  it.each([
    'Linked files/2024/09/Supplier invoices/1_123_invoice.pdf',
    'Linked files/Bank files/statement.xml',
    'Inbox/Vouchers/A1_receipt.pdf',
    '../Linked files/2025/01/Vouchers/A1_receipt.pdf',
    '/Linked files/2025/01/Vouchers/A1_receipt.pdf',
    'Linked files/2025/13/Vouchers/A1_receipt.pdf',
    'Linked files/2025/01/Vouchers/receipt.pdf',
  ])('refuses an unsafe or ambiguous path: %s', (path) => {
    expect(parseFortnoxVoucherAssetPath(path)).toBeNull()
  })
})

describe('fortnoxVoucherAssetKey', () => {
  it('normalizes the voucher series', () => {
    expect(fortnoxVoucherAssetKey(2025, 'a', 64)).toBe('2025|A|64')
  })
})

import { describe, expect, it } from 'vitest'
import { buildBankFileIngestOptions } from '../ingest-options'

describe('buildBankFileIngestOptions', () => {
  it('turns auto_categorize=false into a no-auto-book safeguard', () => {
    expect(buildBankFileIngestOptions({
      autoCategorize: false,
      rawInsertOnly: false,
    })).toEqual({ skipAutoCategorization: true })
  })

  it('preserves explicit categorization and settlement-account choices', () => {
    expect(buildBankFileIngestOptions({
      autoCategorize: true,
      settlementAccount: '1931',
      rawInsertOnly: false,
    })).toEqual({ settlementAccount: '1931' })
  })

  it('keeps viewer imports raw-only while also honoring staging mode', () => {
    expect(buildBankFileIngestOptions({
      autoCategorize: false,
      settlementAccount: '1940',
      rawInsertOnly: true,
    })).toEqual({
      skipAutoCategorization: true,
      settlementAccount: '1940',
      rawInsertOnly: true,
    })
  })
})

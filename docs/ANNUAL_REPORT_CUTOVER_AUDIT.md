# Annual-report and Bolagsverket cutover audit

Date: 2026-07-28  
Company: Goatlab AB (559486-4380)  
Target accounting framework: K2

This is the operational gate for replacing Årsredovisning Online with Accounted. It is intentionally fail-closed: Årsredovisning Online must remain available until every required item below has current evidence.

## Cutover verdict

**Not ready. Do not file from Accounted or retire Årsredovisning Online yet.**

Accounted contains the core annual-report, iXBRL, validation, signature-evidence and Bolagsverket v2.1 submission implementation. Focused automated coverage passes. The deployed STOLAB instance cannot yet execute the complete external workflow, and Goatlab's FY2025 ledger has a mechanically incorrect opening balance caused by the continuation-import guard.

## Required proof before cutover

- [x] K2 annual-report model, completeness checks and iXBRL generator exist.
- [x] Immutable signed version and signature-evidence gates exist.
- [x] Bolagsverket v2.1 own-space upload, control, submission, receipt and registration-status handling exist.
- [x] Duplicate/unknown-submission safeguards exist.
- [x] Focused annual-report and Bolagsverket tests pass (305 passed, 2 skipped on 2026-07-28).
- [ ] Goatlab FY2025 opening balances and annual-report figures reconcile to the Fortnox source.
- [ ] FY2025 is closed correctly and the annual-report readiness gate has no accounting blockers.
- [ ] The exact FY2025 report is rendered and visually reviewed.
- [x] Generated fixture iXBRL passes Accounted preflight and the pinned Arelle service locally.
- [ ] The exact Goatlab FY2025 iXBRL passes Accounted preflight, Arelle and Bolagsverket `kontrollera` in the acceptance environment.
- [ ] Bolagsverket agreement, current terms acceptance, client certificate/key and outgoing-IP allowlist are active.
- [ ] STOLAB can reach the Bolagsverket acceptance endpoint using mTLS.
- [x] The deployed instance has the authenticated Arelle validator URL configured and its live validation path is proven.
- [ ] The deployed instance has the Bolagsverket environment, certificate and filing release flags configured.
- [ ] A complete acceptance rehearsal proves upload, signer handoff, event/poll status and archived receipt without filing production data.
- [ ] The filed FY2024 annual report and receipt are archived independently of Årsredovisning Online.
- [ ] FY2025's prepared Årsredovisning Online report (ID 223585) is compared with Accounted before any signing or submission.
- [ ] The outstanding FY2025 year-result voucher (2099/8999, 164,820.07 SEK) is reconciled and booked exactly once.
- [ ] Goatlab's INK2 is submitted to Skatteverket by 2026-08-03 and the receipt is archived independently of Årsredovisning Online.
- [ ] Backup and restore evidence covers the report XHTML, signature evidence, submission receipt and registration events.
- [x] The deployed full-history archive UI includes supporting documents by default and produces a live pre-download estimate.

## FY2025 opening-balance defect

Authoritative source:

`accounted-migration-vault/fortnox-exports/2026-07-26/fortnox-sie4-2025.se`

The Fortnox source has a balanced `#IB 0` set with net **0.00 SEK**, including:

| Account | Fortnox opening balance | Current Accounted export | Difference |
|---|---:|---:|---:|
| 2099 | -578,717.63 | 0.00 | -578,717.63 |

All other non-zero FY2025 opening-balance accounts match. Accounted's native FY2025 export has an opening-balance net of **+578,717.63 SEK** and an incorrect `#UB 0 2099 578717.63`.

Cause: the importer treated every later-year upload as a continuation and skipped its explicit `#IB` without comparing it with the opening balance derived from prior Accounted activity. The prior FY2024 file represented its result through `#RES`, while Fortnox explicitly carried that result into FY2025 account 2099. The derived path therefore could not reproduce the source.

The code fix on `codex/annual-report-cutover` reconciles every mapped balance-sheet account. It omits an IB entry only for an exact account-by-account match; otherwise it preserves the source IB as an explicit, linked opening-balance entry and records every difference in the import warning.

Regression evidence: 63 focused importer tests pass, including a result-carry-forward case for account 2099.

## Non-mutating live repair preview

No live accounting data has been changed.

Proposed repair for fiscal period `f414d94d-cc1e-4ed2-98d8-0a5cdf716ae1`:

1. Re-read and hash the preserved Fortnox FY2025 SIE file.
2. Verify the full non-zero `#IB 0` set still nets to 0.00 SEK.
3. Verify the period remains open and has no existing opening-balance link.
4. Create one posted `source_type=opening_balance` journal entry dated 2025-01-01 containing the complete Fortnox `#IB 0` set—not merely a one-line adjustment.
5. Link that entry as the FY2025 period's `opening_balance_entry_id` and mark opening balances set in the same controlled operation.
6. Re-export SIE and require exact `#IB 0` agreement with Fortnox after account mapping.
7. Re-run balance sheet, income statement, trial balance and annual-report readiness checks.
8. Stop and reverse through the application's auditable correction mechanism if any invariant fails.

The complete entry must include the source credit on account 2099 of 578,717.63 SEK. Because the entire source IB is balanced, no synthetic equity or rounding line is permitted.

This repair requires explicit action-time approval before it is applied to Goatlab's live ledger.

## Årsredovisning Online source-of-truth review

A read-only review of the authenticated Goatlab AB workspace was completed on
2026-07-28. No form was submitted and no source record was changed.

The service exposes nine annual-report stages that Accounted must cover or
deliberately replace: company details, income statement, balance sheet, tax,
profit/loss disposition, notes, management report, officers, and filing. Its
post-completion handoff also includes the corporate income-tax declaration,
year-end bookkeeping vouchers, AGM minutes, downloadable originals, and filing
status/receipt history.

Evidence for FY2025 report ID `223585`:

- Period: 2025-01-01 through 2025-12-31; all 9/9 preparation stages are marked complete.
- Bolagsverket filing: digital, registered on 2026-07-04 at 11:49.
- Signing mode: electronic signatures; the service offers a signed and sealed original for independent archival.
- INK2: not submitted; displayed statutory deadline is 2026-08-03.
- AGM minutes: a generated PDF is available; the UI correctly states that it is not submitted to Bolagsverket.
- Remaining year-end voucher dated 2025-12-31: debit 2099 and credit 8999 for 164,820.07 SEK.
- The remaining voucher can be exported as SIE 4I or PDF. It must be reconciled against Fortnox and Accounted before booking so it is neither omitted nor duplicated.

The overview also exposes the FY2024 report (`185175`) and its annual-report
original, declaration form, `info.sru`, `blanketter.sru`, field list, tax
calculation, receipt, AGM protocol and bookkeeping instructions. Its INK2
status is displayed as “laddas upp” with an age of 361 days. That is not proof
of submission: a Skatteverket receipt or authoritative submitted-status check
must be preserved before Årsredovisning Online is retired.

The registered FY2025 original, filing evidence, AGM minutes, declaration
artifacts, and year-end voucher exports still need to be downloaded and stored
in the migration vault. Downloading is non-destructive, but no filing or
bookkeeping action is implied by this review.

## Deployment evidence and remaining gaps on 2026-07-28

The authenticated Arelle service and its Accounted integration are deployed.
The live annual-report page visibly runs the service and fails closed when
validation cannot pass. An isolated restore job also restored 172 tables from
the off-cluster PostgreSQL backup and proved the annual-report filing schema
and archive-evidence tables. Those tables were empty because no real Accounted
filing has occurred; the restore proof must be repeated after the acceptance
rehearsal so it covers real report, signature, submission, receipt and event
records.

The statutory full-history archive is now reachable under **Import / Export →
Export → Create backup**. A read-only production check reported **51.7 MB** and
**345 attachments**, with receipts and supporting documents enabled by
default. The download action was not invoked. This proves discoverability and
preflight estimation, not ZIP creation or independent restore of its contents.

The STOLAB deployment still does not contain the required Bolagsverket
environment selection, mTLS certificate/key, or filing release flags. Network
probes from both the development machine and the production pod timed out
against `api-accept2.bolagsverket.se`.

Connected filing must remain disabled until these are provisioned and a fresh acceptance test succeeds. Unit tests or a generated XHTML file do not substitute for that proof.

## Arelle validation evidence

The authenticated validator boundary uses the official `arelle-release` 2.42.1 package, runs without root privileges on a read-only container filesystem, limits request and decoded document sizes, deletes report bytes after each request, restricts top-level taxonomy hosts, and retains only the public taxonomy cache.

Local container evidence on 2026-07-28:

- Bolagsverket's official filed K2 example: passed, zero Arelle issues.
- Accounted's generated K2 fixture before correction: correctly failed on `xmlSchema:valueError` for `ArsstammaResultatDispositionGodkannaStyrelsensForslag`.
- Accounted's generated K2 fixture after correction: passed, zero Arelle issues.
- Cold taxonomy load: approximately 130 seconds.
- Warm taxonomy-cache validation: approximately 5 seconds.

The generator previously used the free wording “förslag till resultatdisposition”, but the taxonomy permits exactly one of two enumeration values: vinstdisposition or behandling av ansamlad förlust. The generator now selects the permitted value from the sign of the total proposed disposition, with profit and accumulated-loss regression tests.

## External actions requiring a person

- A user must explicitly approve downloading the signed originals, filing evidence, AGM minutes, declaration artifacts and year-end voucher exports from Årsredovisning Online into the migration vault.
- A company representative must approve any live opening-balance correction.
- Board/CEO signatures and the fastställelseintyg signer remain human legal acts.
- Production upload/submission to Bolagsverket requires explicit action-time confirmation.

#!/usr/bin/env npx tsx

import { SmtpEmailService } from '@/extensions/general/email/lib/smtp-service'

const toIndex = process.argv.indexOf('--to')
const to = toIndex >= 0 ? process.argv[toIndex + 1] : undefined

if (!to) {
  throw new Error('Usage: npx tsx scripts/verify-smtp.ts --to address@example.com')
}

async function main(): Promise<void> {
  const result = await new SmtpEmailService().sendEmail({
    to,
    subject: 'Accounted SMTP verification',
    text: 'Accounted can send mail through the configured SMTP server.',
    html: '<p>Accounted can send mail through the configured SMTP server.</p>',
  })
  console.log(JSON.stringify(result))
  if (!result.success) process.exitCode = 1
}

void main()

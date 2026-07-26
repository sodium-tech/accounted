import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SmtpEmailService,
  buildSmtpMessage,
  smtpConfigFromEnv,
} from '../lib/smtp-service'

describe('smtpConfigFromEnv', () => {
  it('requires every credential and validates the port', () => {
    expect(smtpConfigFromEnv({ SMTP_HOST: 'mail.example.com' })).toBeNull()
    expect(smtpConfigFromEnv({
      SMTP_HOST: 'mail.example.com',
      SMTP_PORT: '70000',
      SMTP_USER: 'user',
      SMTP_PASSWORD: 'secret',
      SMTP_FROM_EMAIL: 'books@example.com',
    })).toBeNull()
  })

  it('defaults to implicit TLS on port 465', () => {
    expect(smtpConfigFromEnv({
      SMTP_HOST: 'mail.example.com',
      SMTP_USER: 'user',
      SMTP_PASSWORD: 'secret',
      SMTP_FROM_EMAIL: 'books@example.com',
    })).toEqual({
      host: 'mail.example.com',
      tlsServername: 'mail.example.com',
      port: 465,
      secure: true,
      user: 'user',
      password: 'secret',
      fromEmail: 'books@example.com',
    })
  })
})

describe('buildSmtpMessage', () => {
  it('builds alternative MIME content and attachments without exposing BCC', () => {
    const result = buildSmtpMessage({
      to: 'customer@example.com',
      cc: ['copy@example.com'],
      bcc: 'archive@example.com',
      subject: 'Invoice 42',
      html: '<p>Attached invoice.</p>',
      attachments: [{
        filename: 'invoice.pdf',
        content: Buffer.from('%PDF-test'),
        contentType: 'application/pdf',
      }],
    }, 'books@example.com')

    expect(result.recipients).toEqual([
      'customer@example.com',
      'copy@example.com',
      'archive@example.com',
    ])
    expect(result.message).toContain('To: customer@example.com')
    expect(result.message).toContain('Cc: copy@example.com')
    expect(result.message).not.toContain('Bcc:')
    expect(result.message).toContain('Content-Type: multipart/alternative')
    expect(result.message).toContain('filename="invoice.pdf"')
    expect(result.message).toContain(Buffer.from('%PDF-test').toString('base64'))
  })

  it('rejects header injection in recipient addresses', () => {
    expect(() => buildSmtpMessage({
      to: 'customer@example.com\r\nBcc: attacker@example.com',
      subject: 'Invoice',
      html: '<p>Invoice</p>',
    }, 'books@example.com')).toThrow('Invalid recipient address')
  })
})

describe('SmtpEmailService', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('returns a provider error when SMTP is not configured', async () => {
    delete process.env.SMTP_HOST
    const service = new SmtpEmailService(vi.fn())
    await expect(service.sendEmail({
      to: 'customer@example.com',
      subject: 'Invoice',
      html: '<p>Invoice</p>',
    })).resolves.toEqual({
      success: false,
      provider: 'smtp',
      error: 'SMTP is not configured',
    })
  })

  it('passes the MIME message and complete envelope to the SMTP sender', async () => {
    Object.assign(process.env, {
      SMTP_HOST: 'mail.example.com',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: 'user',
      SMTP_PASSWORD: 'secret',
      SMTP_FROM_EMAIL: 'books@example.com',
    })
    const sender = vi.fn().mockResolvedValue('queue-42')
    const service = new SmtpEmailService(sender)
    const result = await service.sendEmail({
      to: 'customer@example.com',
      bcc: 'archive@example.com',
      subject: 'Invoice 42',
      html: '<p>Invoice</p>',
    })

    expect(result).toEqual({ success: true, provider: 'smtp', messageId: 'queue-42' })
    expect(sender).toHaveBeenCalledOnce()
    expect(sender.mock.calls[0][1]).toMatchObject({
      from: 'books@example.com',
      recipients: ['customer@example.com', 'archive@example.com'],
    })
  })
})

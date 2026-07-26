import { randomBytes } from 'node:crypto'
import { connect as connectNet, type Socket } from 'node:net'
import { connect as connectTls, type TLSSocket } from 'node:tls'
import { createLogger } from '@/lib/logger'
import { getBranding } from '@/lib/branding/service'
import type { EmailService, SendEmailOptions, SendEmailResult } from '@/lib/email/service'

const log = createLogger('email-smtp')

interface SmtpConfig {
  host: string
  tlsServername: string
  port: number
  secure: boolean
  user: string
  password: string
  fromEmail: string
}

interface SmtpEnvelope {
  from: string
  recipients: string[]
  message: string
}

type SmtpSender = (config: SmtpConfig, envelope: SmtpEnvelope) => Promise<string | undefined>

function sanitizeHeaderPart(value: string): string {
  return value.replace(/[\r\n<>]/g, '').trim()
}

function addresses(value: string | string[] | undefined): string[] {
  if (!value) return []
  return (Array.isArray(value) ? value : [value]).map((item) => item.trim()).filter(Boolean)
}

function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value
  return `=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`
}

function wrapBase64(value: Buffer): string {
  return value.toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? ''
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

export function smtpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SmtpConfig | null {
  const host = env.SMTP_HOST?.trim()
  const user = env.SMTP_USER?.trim()
  const password = env.SMTP_PASSWORD
  const fromEmail = env.SMTP_FROM_EMAIL?.trim()
  if (!host || !user || !password || !fromEmail) return null

  const port = Number(env.SMTP_PORT || '465')
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return {
    host,
    tlsServername: env.SMTP_TLS_SERVERNAME?.trim() || host,
    port,
    secure: env.SMTP_SECURE !== 'false',
    user,
    password,
    fromEmail,
  }
}

export function buildSmtpMessage(
  options: SendEmailOptions,
  fromEmail: string,
): { message: string; recipients: string[] } {
  const to = addresses(options.to)
  const cc = addresses(options.cc)
  const bcc = addresses(options.bcc)
  const recipients = [...new Set([...to, ...cc, ...bcc])]
  if (to.length === 0) throw new Error('At least one recipient is required')
  if (recipients.some((value) => /[\r\n<>]/.test(value))) throw new Error('Invalid recipient address')

  const appName = sanitizeHeaderPart(getBranding().appName)
  const senderName = sanitizeHeaderPart(options.fromName || appName)
  const replyTo = options.replyTo?.trim()
  if (replyTo && /[\r\n<>]/.test(replyTo)) throw new Error('Invalid reply-to address')

  const mixedBoundary = `accounted-mixed-${randomBytes(12).toString('hex')}`
  const alternativeBoundary = `accounted-alt-${randomBytes(12).toString('hex')}`
  const headers = [
    `From: ${encodeHeader(senderName)} <${fromEmail}>`,
    `To: ${to.join(', ')}`,
    ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []),
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    `Subject: ${encodeHeader(sanitizeHeaderPart(options.subject))}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomBytes(16).toString('hex')}@${fromEmail.split('@')[1] || 'localhost'}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
  ]

  const text = options.text || htmlToText(options.html)
  const parts = [
    ...headers,
    '',
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
    '',
    `--${alternativeBoundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(Buffer.from(text)),
    `--${alternativeBoundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(Buffer.from(options.html)),
    `--${alternativeBoundary}--`,
  ]

  for (const attachment of options.attachments ?? []) {
    const filename = sanitizeHeaderPart(attachment.filename).replace(/"/g, '') || 'attachment'
    const content = typeof attachment.content === 'string'
      ? Buffer.from(attachment.content, 'base64')
      : Buffer.from(attachment.content)
    parts.push(
      `--${mixedBoundary}`,
      `Content-Type: ${attachment.contentType || 'application/octet-stream'}; name="${filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${filename}"`,
      '',
      wrapBase64(content),
    )
  }

  parts.push(`--${mixedBoundary}--`, '')
  return { message: parts.join('\r\n'), recipients }
}

class SmtpConnection {
  private buffer = ''
  private waiters: Array<(line: string) => void> = []
  private readonly onData = (chunk: string): void => {
    this.buffer += chunk
    this.flush()
  }

  constructor(private socket: Socket | TLSSocket) {
    this.bind(socket)
  }

  private bind(socket: Socket | TLSSocket): void {
    socket.setEncoding('utf8')
    socket.on('data', this.onData)
  }

  private flush(): void {
    while (this.waiters.length > 0) {
      const match = this.buffer.match(/^(?:\d{3}-.*\r\n)*(\d{3}) [\s\S]*(?:\r\n|$)/)
      if (!match) return
      const end = match.index! + match[0].length
      const response = this.buffer.slice(0, end)
      this.buffer = this.buffer.slice(end)
      this.waiters.shift()!(response)
    }
  }

  response(): Promise<string> {
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => reject(error)
      this.socket.once('error', onError)
      this.waiters.push((line) => {
        this.socket.off('error', onError)
        resolve(line)
      })
      this.flush()
    })
  }

  async command(command: string, expected: number[]): Promise<string> {
    this.socket.write(`${command}\r\n`)
    const response = await this.response()
    const code = Number(response.slice(0, 3))
    if (!expected.includes(code)) throw new Error(`SMTP command failed with status ${code}`)
    return response
  }

  upgrade(servername: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.off('data', this.onData)
      const tlsSocket = connectTls({ socket: this.socket, servername }, () => {
        this.socket = tlsSocket
        this.bind(tlsSocket)
        resolve()
      })
      tlsSocket.once('error', reject)
    })
  }

  close(): void {
    this.socket.end()
  }
}

function openSocket(config: SmtpConfig): Promise<Socket | TLSSocket> {
  return new Promise((resolve, reject) => {
    const options = { host: config.host, port: config.port, servername: config.tlsServername }
    const socket = config.secure
      ? connectTls(options, () => resolve(socket))
      : connectNet(options, () => resolve(socket))
    socket.setTimeout(30_000, () => socket.destroy(new Error('SMTP connection timed out')))
    socket.once('error', reject)
  })
}

export const sendViaSmtp: SmtpSender = async (config, envelope) => {
  const connection = new SmtpConnection(await openSocket(config))
  try {
    const greeting = await connection.response()
    if (!greeting.startsWith('220')) throw new Error('SMTP server rejected connection')
    await connection.command('EHLO accounted', [250])
    if (!config.secure) {
      await connection.command('STARTTLS', [220])
      await connection.upgrade(config.tlsServername)
      await connection.command('EHLO accounted', [250])
    }
    await connection.command('AUTH LOGIN', [334])
    await connection.command(Buffer.from(config.user).toString('base64'), [334])
    await connection.command(Buffer.from(config.password).toString('base64'), [235])
    await connection.command(`MAIL FROM:<${envelope.from}>`, [250])
    for (const recipient of envelope.recipients) {
      await connection.command(`RCPT TO:<${recipient}>`, [250, 251])
    }
    await connection.command('DATA', [354])
    const escaped = envelope.message.replace(/(^|\r\n)\./g, '$1..')
    const response = await connection.command(`${escaped}\r\n.`, [250])
    await connection.command('QUIT', [221])
    return response.match(/queued as\s+([^\s]+)/i)?.[1]
  } finally {
    connection.close()
  }
}

export class SmtpEmailService implements EmailService {
  constructor(private sender: SmtpSender = sendViaSmtp) {}

  isConfigured(): boolean {
    return smtpConfigFromEnv() !== null
  }

  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    const config = smtpConfigFromEnv()
    if (!config) return { success: false, provider: 'smtp', error: 'SMTP is not configured' }
    try {
      const built = buildSmtpMessage(options, config.fromEmail)
      const messageId = await this.sender(config, {
        from: config.fromEmail,
        recipients: built.recipients,
        message: built.message,
      })
      return { success: true, provider: 'smtp', messageId }
    } catch (error) {
      log.error('Failed to send email through SMTP', error)
      return {
        success: false,
        provider: 'smtp',
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }
}

import { NextResponse } from 'next/server'
import { withRouteContext } from '@/lib/api/with-route-context'
import { errorResponse } from '@/lib/errors/get-structured-error'
import { buildAnnualMeetingProtocol } from '@/lib/bokslut/arsredovisning/package-service'

function incomplete(message: string) {
  return NextResponse.json(
    { error: { code: 'ANNUAL_MEETING_INCOMPLETE', message } },
    { status: 422 },
  )
}

export const GET = withRouteContext(
  'period.arsredovisning_agm_pdf',
  async (request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const { supabase, companyId, log, requestId } = ctx
    const versionId = new URL(request.url).searchParams.get('version')
    if (!versionId) return incomplete('Välj en signerad årsredovisningsversion.')
    try {
      const artifact = await buildAnnualMeetingProtocol(
        supabase,
        companyId,
        id,
        versionId,
      )
      return new Response(artifact.bytes.slice().buffer as ArrayBuffer, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${artifact.filename}"`,
          'Cache-Control': 'private, no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
          'X-Annual-Report-Version': versionId,
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (/finalized AGM|another annual-report version|requires a signed version|signature evidence/i.test(message)) {
        return incomplete(message)
      }
      return errorResponse(error, log, { requestId })
    }
  },
)

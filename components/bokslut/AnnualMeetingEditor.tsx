'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, FileArchive, FileDown, Loader2, Plus, Save, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import { getErrorMessage } from '@/lib/errors/get-error-message'
import type { ArsredovisningData } from '@/lib/bokslut/arsredovisning/types'
import type { SignatureRequest } from '@/lib/bokslut/arsredovisning/signature-service'
import type { AnnualReportVersionSummary } from '@/lib/bokslut/arsredovisning/compliance-types'
import type { AnnualMeetingAttendee, AnnualMeetingRecord } from '@/lib/bokslut/arsredovisning/agm-service'

type Props = {
  periodId: string
  report: ArsredovisningData
  versions: AnnualReportVersionSummary[]
  signatures: SignatureRequest[]
}

const archivabileStatuses = new Set(['signed', 'filed', 'registered'])

function namesFromLines(value: string): string[] {
  return value.split('\n').map((name) => name.trim()).filter(Boolean)
}

export function AnnualMeetingEditor({ periodId, report, versions, signatures }: Props) {
  const { toast } = useToast()
  const signedVersions = useMemo(
    () => versions.filter((version) => archivabileStatuses.has(version.status)),
    [versions],
  )
  const signedNames = useMemo(
    () => signatures.filter((signature) => signature.status === 'signed').map((signature) => signature.signer_name),
    [signatures],
  )
  const [record, setRecord] = useState<AnnualMeetingRecord | null>(null)
  const [shareCount, setShareCount] = useState<number | null>(null)
  const [versionId, setVersionId] = useState('')
  const [meetingDate, setMeetingDate] = useState(report.forvaltningsberattelse.agm_date ?? '')
  const [meetingCity, setMeetingCity] = useState(report.company.city ?? '')
  const [attendees, setAttendees] = useState<AnnualMeetingAttendee[]>([])
  const [chairName, setChairName] = useState('')
  const [minutesKeeperName, setMinutesKeeperName] = useState('')
  const [adjusterName, setAdjusterName] = useState('')
  const [boardMembers, setBoardMembers] = useState('')
  const [boardAlternates, setBoardAlternates] = useState('')
  const [boardFeeResolution, setBoardFeeResolution] = useState('Inget styrelsearvode ska utgå.')
  const [otherMatters, setOtherMatters] = useState('')
  const [convenedCorrectly, setConvenedCorrectly] = useState(false)
  const [statementsAdopted, setStatementsAdopted] = useState(false)
  const [dischargeGranted, setDischargeGranted] = useState(false)
  const [busy, setBusy] = useState(false)
  const finalized = record?.finalized_at !== null && record?.finalized_at !== undefined

  const applyRecord = useCallback((next: AnnualMeetingRecord) => {
    setRecord(next)
    setVersionId(next.annual_report_version_id)
    setMeetingDate(next.meeting_date)
    setMeetingCity(next.meeting_city)
    setAttendees(next.attendees)
    setChairName(next.chair_name)
    setMinutesKeeperName(next.minutes_keeper_name)
    setAdjusterName(next.adjuster_name)
    setBoardMembers(next.board_members.join('\n'))
    setBoardAlternates(next.board_alternates.join('\n'))
    setBoardFeeResolution(next.board_fee_resolution)
    setOtherMatters(next.other_matters ?? '')
    setConvenedCorrectly(next.convened_correctly)
    setStatementsAdopted(next.statements_adopted)
    setDischargeGranted(next.discharge_granted)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/bookkeeping/fiscal-periods/${periodId}/arsredovisning/agm`)
      .then((response) => response.json())
      .then((body) => {
        if (cancelled) return
        setShareCount(body.share_count ?? null)
        if (body.data) {
          applyRecord(body.data as AnnualMeetingRecord)
          return
        }
        const defaultName = signedNames[0] ?? ''
        setVersionId(signedVersions.at(-1)?.id ?? '')
        setChairName(defaultName)
        setMinutesKeeperName(defaultName)
        setAdjusterName(defaultName)
        setBoardMembers(signedNames.join('\n'))
        if (defaultName && body.share_count) {
          setAttendees([{ name: defaultName, shares: body.share_count, votes: body.share_count }])
        }
      })
      .catch(() => toast({ title: 'Kunde inte hämta årsstämmouppgifter', variant: 'destructive' }))
    return () => { cancelled = true }
  }, [applyRecord, periodId, signedNames, signedVersions, toast])

  const updateAttendee = (index: number, patch: Partial<AnnualMeetingAttendee>) => {
    setAttendees((current) => current.map((attendee, i) => i === index ? { ...attendee, ...patch } : attendee))
  }

  const payload = () => ({
    annual_report_version_id: versionId,
    meeting_date: meetingDate,
    meeting_city: meetingCity,
    attendees,
    chair_name: chairName,
    minutes_keeper_name: minutesKeeperName,
    adjuster_name: adjusterName,
    board_members: namesFromLines(boardMembers),
    board_alternates: namesFromLines(boardAlternates),
    board_fee_resolution: boardFeeResolution,
    other_matters: otherMatters.trim() || null,
    convened_correctly: convenedCorrectly,
    statements_adopted: statementsAdopted,
    discharge_granted: dischargeGranted,
  })

  const save = async () => {
    setBusy(true)
    try {
      const response = await fetch(`/api/bookkeeping/fiscal-periods/${periodId}/arsredovisning/agm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(getErrorMessage(body.error) ?? 'Kunde inte spara stämmouppgifterna')
      applyRecord(body.data as AnnualMeetingRecord)
      toast({ title: 'Årsstämmouppgifterna sparades' })
    } catch {
      toast({ title: 'Kunde inte spara stämmouppgifterna', variant: 'destructive' })
    } finally { setBusy(false) }
  }

  const finalize = async () => {
    setBusy(true)
    try {
      const response = await fetch(`/api/bookkeeping/fiscal-periods/${periodId}/arsredovisning/agm`, { method: 'PATCH' })
      const body = await response.json()
      if (!response.ok) throw new Error(getErrorMessage(body.error) ?? 'Kunde inte låsa stämmoprotokollet')
      applyRecord(body.data as AnnualMeetingRecord)
      toast({ title: 'Årsstämmoprotokollet är låst' })
    } catch {
      toast({ title: 'Kunde inte låsa stämmoprotokollet', variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <section>
      <div className="mb-1 flex items-center gap-2 px-1">
        <h3 className="font-sans text-xs font-medium uppercase tracking-wider text-muted-foreground">Årsstämma och komplett arkivpaket</h3>
        <div className="h-px flex-1 bg-border/60" />
        {finalized && <Badge variant="success">Låst</Badge>}
      </div>
      <p className="px-1 text-xs leading-5 text-muted-foreground">
        Kontrollera de faktiska stämmobesluten. Accounted skapar sedan protokoll och ett ZIP-paket med årsredovisning, iXBRL, signeringsbevis, validering och kontrollsummor. Inget skickas till en myndighet härifrån.
      </p>
      <fieldset disabled={finalized || busy} className="grid gap-4 px-1 pt-4 md:grid-cols-2 disabled:opacity-70">
        <div className="space-y-2"><Label>Signerad årsredovisning</Label><Select value={versionId} onValueChange={setVersionId}><SelectTrigger><SelectValue placeholder="Välj signerad version" /></SelectTrigger><SelectContent>{signedVersions.map((version) => <SelectItem key={version.id} value={version.id}>Version {version.version_number}: {version.content_hash.slice(0, 12)}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-2"><Label>Stämmodatum</Label><Input type="date" value={meetingDate} onChange={(event) => setMeetingDate(event.target.value)} /></div>
        <div className="space-y-2"><Label>Ort</Label><Input value={meetingCity} onChange={(event) => setMeetingCity(event.target.value)} /></div>
        <div className="space-y-2"><Label>Registrerade aktier</Label><Input value={shareCount ?? 'Saknas'} readOnly /></div>
        <div className="space-y-2"><Label>Ordförande</Label><Input value={chairName} onChange={(event) => setChairName(event.target.value)} /></div>
        <div className="space-y-2"><Label>Protokollförare</Label><Input value={minutesKeeperName} onChange={(event) => setMinutesKeeperName(event.target.value)} /></div>
        <div className="space-y-2"><Label>Justeringsperson</Label><Input value={adjusterName} onChange={(event) => setAdjusterName(event.target.value)} /></div>
        <div className="space-y-2"><Label>Styrelseledamöter, en per rad</Label><Textarea value={boardMembers} onChange={(event) => setBoardMembers(event.target.value)} /></div>
        <div className="space-y-2"><Label>Styrelsesuppleanter, en per rad</Label><Textarea value={boardAlternates} onChange={(event) => setBoardAlternates(event.target.value)} /></div>
        <div className="space-y-2"><Label>Styrelsearvode</Label><Textarea value={boardFeeResolution} onChange={(event) => setBoardFeeResolution(event.target.value)} /></div>
        <div className="space-y-2 md:col-span-2"><Label>Övriga frågor</Label><Textarea value={otherMatters} onChange={(event) => setOtherMatters(event.target.value)} placeholder="Lämna tomt om inga övriga frågor noterades" /></div>
        <div className="space-y-3 md:col-span-2">
          <div className="flex items-center justify-between"><Label>Röstlängd</Label><Button type="button" size="sm" variant="outline" onClick={() => setAttendees((current) => [...current, { name: '', shares: 1, votes: 1 }])}><Plus className="mr-1 h-4 w-4" /> Aktieägare</Button></div>
          {attendees.map((attendee, index) => <div key={index} className="grid gap-2 sm:grid-cols-[1fr_140px_140px_44px]"><Input aria-label={`Namn ${index + 1}`} value={attendee.name} onChange={(event) => updateAttendee(index, { name: event.target.value })} placeholder="Namn" /><Input aria-label={`Aktier ${index + 1}`} type="number" min={1} value={attendee.shares} onChange={(event) => updateAttendee(index, { shares: Number(event.target.value) })} /><Input aria-label={`Röster ${index + 1}`} type="number" min={1} value={attendee.votes} onChange={(event) => updateAttendee(index, { votes: Number(event.target.value) })} /><Button type="button" size="icon" variant="ghost" aria-label="Ta bort aktieägare" onClick={() => setAttendees((current) => current.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button></div>)}
        </div>
        {[[convenedCorrectly, setConvenedCorrectly, 'Stämman var behörigen sammankallad'], [statementsAdopted, setStatementsAdopted, 'Resultat- och balansräkningen fastställdes'], [dischargeGranted, setDischargeGranted, 'Styrelsen beviljades ansvarsfrihet']] .map(([checked, setter, label]) => <label key={String(label)} className="flex items-center gap-2 text-sm md:col-span-2"><Checkbox checked={checked as boolean} onCheckedChange={(value) => (setter as (value: boolean) => void)(value === true)} />{String(label)}</label>)}
      </fieldset>
      <div className="flex flex-wrap gap-3 px-1 pt-4">
        {!finalized && <><Button onClick={() => void save()} disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Spara</Button><Button variant="outline" onClick={() => void finalize()} disabled={busy || !record}><CheckCircle2 className="mr-2 h-4 w-4" />Lås protokoll</Button></>}
        {finalized && record && <><Button asChild><a href={`/api/bookkeeping/fiscal-periods/${periodId}/arsredovisning/package?version=${record.annual_report_version_id}`}><FileArchive className="mr-2 h-4 w-4" />Ladda ner komplett paket</a></Button><Button variant="outline" asChild><a href={`/api/bookkeeping/fiscal-periods/${periodId}/arsredovisning/agm/pdf?version=${record.annual_report_version_id}`} target="_blank" rel="noopener noreferrer"><FileDown className="mr-2 h-4 w-4" />Årsstämmoprotokoll</a></Button></>}
      </div>
    </section>
  )
}

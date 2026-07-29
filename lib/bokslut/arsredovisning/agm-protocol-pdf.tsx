import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { AnnualMeetingRecord } from './agm-service'
import type { ArsredovisningData } from './types'

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingHorizontal: 52,
    paddingBottom: 56,
    fontFamily: 'Helvetica',
    fontSize: 10,
    lineHeight: 1.35,
  },
  title: { fontFamily: 'Helvetica-Bold', fontSize: 20, marginBottom: 5 },
  company: { fontFamily: 'Helvetica-Bold', fontSize: 12, marginBottom: 2 },
  intro: { marginTop: 14, marginBottom: 18 },
  heading: { fontFamily: 'Helvetica-Bold', fontSize: 11, marginTop: 11, marginBottom: 3 },
  paragraph: { marginBottom: 4 },
  attendeeHeader: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#888',
    paddingBottom: 3,
    fontFamily: 'Helvetica-Bold',
  },
  attendeeRow: { flexDirection: 'row', paddingTop: 4 },
  attendeeName: { flex: 1 },
  attendeeNumber: { width: 90, textAlign: 'right' },
  signatureBlock: { marginTop: 30 },
  signatureLine: {
    width: 240,
    borderTopWidth: 0.5,
    borderTopColor: '#222',
    marginTop: 30,
    paddingTop: 4,
  },
  footer: {
    position: 'absolute',
    left: 52,
    right: 52,
    bottom: 28,
    textAlign: 'center',
    color: '#777',
    fontSize: 8,
  },
})

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} och ${names.at(-1)}`
}

export function AnnualMeetingProtocolPDF({
  report,
  meeting,
}: {
  report: ArsredovisningData
  meeting: AnnualMeetingRecord
}) {
  const disposition =
    report.forvaltningsberattelse.agm_disposition_outcome === 'alternative_decision'
      ? report.forvaltningsberattelse.agm_disposition_decision
      : report.forvaltningsberattelse.resultatdisposition

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Protokoll årsstämma</Text>
        <Text style={styles.company}>{report.company.name}</Text>
        <Text>{report.company.org_number}</Text>
        <Text style={styles.intro}>
          Protokoll fört vid årsstämma i {meeting.meeting_city} {meeting.meeting_date}.
        </Text>

        <Text style={styles.heading}>Närvarande</Text>
        <View style={styles.attendeeHeader}>
          <Text style={styles.attendeeName}>Namn</Text>
          <Text style={styles.attendeeNumber}>Antal aktier</Text>
          <Text style={styles.attendeeNumber}>Antal röster</Text>
        </View>
        {meeting.attendees.map((attendee) => (
          <View key={`${attendee.name}-${attendee.shares}`} style={styles.attendeeRow}>
            <Text style={styles.attendeeName}>{attendee.name}</Text>
            <Text style={styles.attendeeNumber}>{attendee.shares.toLocaleString('sv-SE')}</Text>
            <Text style={styles.attendeeNumber}>{attendee.votes.toLocaleString('sv-SE')}</Text>
          </View>
        ))}

        <Text style={styles.heading}>§1 Val av ordförande och protokollförare</Text>
        <Text style={styles.paragraph}>
          Till ordförande valdes {meeting.chair_name}. Till protokollförare valdes{' '}
          {meeting.minutes_keeper_name}.
        </Text>

        <Text style={styles.heading}>§2 Upprättande och godkännande av röstlängd</Text>
        <Text style={styles.paragraph}>
          Ovanstående förteckning över närvarande aktieägare godkändes att gälla som
          röstlängd vid stämman. Samtliga aktier i bolaget var företrädda.
        </Text>

        <Text style={styles.heading}>§3 Godkännande av dagordning</Text>
        <Text style={styles.paragraph}>Stämman godkände förelagt förslag till dagordning.</Text>

        <Text style={styles.heading}>§4 Val av justeringsperson</Text>
        <Text style={styles.paragraph}>Till justeringsperson valdes {meeting.adjuster_name}.</Text>

        <Text style={styles.heading}>§5 Stämmans behöriga sammankallande</Text>
        <Text style={styles.paragraph}>
          Stämman förklarades {meeting.convened_correctly ? 'behörigen sammankallad' : 'inte behörigen sammankallad'}.
        </Text>

        <Text style={styles.heading}>§6 Framläggande av årsredovisningen</Text>
        <Text style={styles.paragraph}>
          Styrelsens årsredovisning för räkenskapsåret {report.fiscal_period.period_start}–
          {report.fiscal_period.period_end} framlades.
        </Text>

        <Text style={styles.heading}>§7 Beslut</Text>
        <Text style={styles.paragraph}>
          a) {meeting.statements_adopted ? 'Resultaträkningen och balansräkningen fastställdes.' : 'Resultaträkningen och balansräkningen fastställdes inte.'}
        </Text>
        <Text style={styles.paragraph}>
          b) Beträffande bolagets resultat beslutade stämman: {disposition ?? 'Beslut saknas.'}
        </Text>
        <Text style={styles.paragraph}>
          c) Styrelseledamöterna {meeting.discharge_granted ? 'beviljades' : 'beviljades inte'} ansvarsfrihet för räkenskapsåret.
        </Text>

        <Text style={styles.footer}>Årsstämmoprotokoll · {report.company.name}</Text>
      </Page>

      <Page size="A4" style={styles.page}>
        <Text style={styles.heading}>§8 Fastställande av arvoden till styrelsen</Text>
        <Text style={styles.paragraph}>{meeting.board_fee_resolution}</Text>

        <Text style={styles.heading}>§9 Val av styrelse</Text>
        <Text style={styles.paragraph}>
          Till ordinarie styrelseledamöter för tiden intill slutet av nästa årsstämma valdes{' '}
          {listNames(meeting.board_members)}.
        </Text>
        {meeting.board_alternates.length > 0 && (
          <Text style={styles.paragraph}>
            Till styrelsesuppleanter valdes {listNames(meeting.board_alternates)}.
          </Text>
        )}
        <Text style={styles.heading}>§10 Övriga frågor</Text>
        <Text style={styles.paragraph}>{meeting.other_matters?.trim() || 'Inga övriga frågor noterades.'}</Text>

        <Text style={styles.heading}>§11 Stämmans avslutande</Text>
        <Text style={styles.paragraph}>Ordföranden förklarade stämman avslutad.</Text>

        <View style={styles.signatureBlock}>
          <Text>Vid protokollet</Text>
          <Text style={styles.signatureLine}>{meeting.minutes_keeper_name}</Text>
        </View>
        <View style={styles.signatureBlock}>
          <Text>Justeras</Text>
          <Text style={styles.signatureLine}>{meeting.adjuster_name}</Text>
        </View>

        <Text style={styles.footer}>Årsstämmoprotokoll · {report.company.name}</Text>
      </Page>
    </Document>
  )
}

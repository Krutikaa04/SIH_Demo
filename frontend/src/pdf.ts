import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

/** Client-side PDF of a report: letterhead, KPI strip and the table. (Charts are not embedded in this prototype.) */
export function exportReportPdf(rep: any) {
  const landscape = rep.columns.length > 6
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' })
  const w = doc.internal.pageSize.getWidth()
  doc.setFillColor(11, 42, 74); doc.rect(0, 0, w, 64, 'F')
  doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(15)
  doc.text('AICTE — Integrated Complaint Monitoring Dashboard', 36, 28)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5)
  doc.text('Prototype report · synthetic data', 36, 46)
  doc.setTextColor(20); doc.setFont('helvetica', 'bold'); doc.setFontSize(14)
  doc.text(rep.title, 36, 92)
  const filterParts: string[] = []
  if (rep.filters?.region) filterParts.push(`Region: ${rep.filters.region}`)
  if (rep.filters?.bureau) filterParts.push(`Bureau: ${rep.filters.bureau}`)
  if (rep.filters?.date_from) filterParts.push(`From: ${rep.filters.date_from}`)
  if (rep.filters?.date_to) filterParts.push(`To: ${rep.filters.date_to}`)
  if (rep.filters?.period) filterParts.push(`Period: ${rep.filters.period}`)
  const filterText = filterParts.length > 0 ? `   ·   Filters: ${filterParts.join(', ')}` : ''
  doc.text(`Scope: ${rep.scope}${filterText}   ·   Generated: ${rep.generated_at.replace('T', ' ')}`, 36, 108)

  let x = 36
  const bw = (w - 72 - 3 * 10) / 4
  rep.summary.forEach((s: any) => {
    doc.setDrawColor(210); doc.setFillColor(247, 249, 252); doc.roundedRect(x, 120, bw, 38, 4, 4, 'FD')
    doc.setTextColor(100); doc.setFontSize(8); doc.text(s.label.toUpperCase(), x + 8, 134)
    doc.setTextColor(11, 42, 74); doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(String(s.value), x + 8, 151)
    doc.setFont('helvetica', 'normal'); x += bw + 10
  })

  autoTable(doc, {
    startY: 174,
    head: [rep.columns.map((c: any) => c.label)],
    body: rep.rows.map((r: any) => rep.columns.map((c: any) => (r[c.key] ?? ''))),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [11, 42, 74], textColor: 255 },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    margin: { left: 36, right: 36 },
    didDrawPage: () => {
      const h = doc.internal.pageSize.getHeight()
      doc.setFontSize(8); doc.setTextColor(130)
      doc.text('Synthetic prototype data — not an official AICTE record', 36, h - 20)
      doc.text(`Page ${doc.getNumberOfPages()}`, w - 70, h - 20)
    },
  })
  doc.save(`aicte_${rep.kind}_report.pdf`)
}

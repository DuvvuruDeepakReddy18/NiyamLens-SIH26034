"""Generate a shareable PDF from the redacted, completed release evidence only."""
import json
import sys
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from pypdf import PdfReader
import pypdfium2 as pdfium

root = Path(__file__).resolve().parents[1]
r = json.loads((root / 'reports/rc6-release-2026-09-05/release-evidence.json').read_text(encoding='utf-8'))
assert r['probes']['passed'] and r['containment']['allVerifiedInactive'] and r['chromeOfflineSeal']['passed']
output = root / 'docs/NiyamLens_RC6_Team_Handoff_2026-09-05.pdf'
check_only = sys.argv[1:] == ['--check-existing']
if output.exists() and not check_only:
    raise SystemExit('Create-only output already exists; make a reviewed new version instead.')
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='BodyRC', fontName='Helvetica', fontSize=10, leading=14, textColor=colors.HexColor('#253e38'), spaceAfter=8))
styles.add(ParagraphStyle(name='SmallRC', parent=styles['BodyRC'], fontSize=8.5, leading=11, spaceAfter=5))
styles.add(ParagraphStyle(name='HeadingRC', parent=styles['Heading2'], fontSize=16, leading=19, textColor=colors.HexColor('#00644f'), spaceBefore=12, spaceAfter=9))
styles.add(ParagraphStyle(name='TitleRC', fontName='Helvetica-Bold', fontSize=29, leading=33, textColor=colors.HexColor('#103d33'), spaceAfter=14))
story = []
def para(text, style='BodyRC'):
    return Paragraph(text, styles[style])
def p(text, style='BodyRC'):
    story.append(para(text, style))
def heading(text):
    p(text, 'HeadingRC')
def table(rows, widths):
    data = [[para(escape(str(cell)), 'SmallRC') for cell in row] for row in rows]
    t = Table(data, colWidths=widths, hAlign='LEFT', repeatRows=1)
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#dfede5')),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),6),('LINEBELOW',(0,0),(-1,-1),.4,colors.HexColor('#c8d5cb'))]))
    story.append(t)
def footer(canvas, doc):
    canvas.setStrokeColor(colors.HexColor('#b7c9be')); canvas.line(42,42,A4[0]-42,42)
    canvas.setFillColor(colors.HexColor('#526e62')); canvas.setFont('Helvetica',8)
    canvas.drawString(42,28,'NiyamLens / RC6 / 5 September 2026 / engineering evidence, not certification')
    canvas.drawRightString(A4[0]-42,28,str(doc.page))

p('TEAM HANDOFF / SIH26034 / 05 SEP 2026','SmallRC')
p('The release is live.\nThe field proof is next.'.replace('\n','<br/>'),'TitleRC')
p('NiyamLens 0.4.4 &nbsp; | &nbsp; Rule pack LMPC-RC-2026.09-RC6')
p('<link href="https://niyamlens-sih26034.vercel.app/" color="#007657">Open the live NiyamLens website</link>')
p('<b>Do not call this winner-ready yet.</b> The engineering release passes the checks below. Recognition on unfamiliar real packages, time saved and qualified legal/measurement validation remain unproven.')
heading('What is fixed and verified')
table([
 ['Check','Observed result','Boundary'],
 ['GitHub verification','603/603 release tests; build, asset integrity and dependency audit passed','Release commit d13aad5'],
 ['Interrupted upload','Prepare retry recovers already uploaded, unregistered bytes; repeat is idempotent','Actual hosted Auth/Storage'],
 ['Stale changes','Reviews and assignments return 409; recorded state remains unchanged','Four-function migration rehearsed and applied'],
 ['Hosted API acceptance','41 authorization + 27 additional checks passed','Four synthetic users / two test workspaces'],
 ['Hosted Chrome roles','4/4 sign-ins, correct lists, fresh image retrieval and export','Not real participant testing'],
 ['Hosted disconnected workflow','OCR, offline seal, queued reload, reconnect, one server seal, fresh export passed','OCR ran online first; real session expiry not tested here'],
 ['Containment','4/4 synthetic memberships disabled; marked evidence retained','No human account or password changed'],
 ['Public release probes',f"{r['probes']['requests']} checks passed in 16 snapshots over 15 minutes",'Low-volume probes, not maximum-load stress'],
], [118,216,177])
heading('The recognition result you must disclose')
p('<b>Eight known development photos / ten readable target fields:</b> direct raw recovery 1/10; with automatically selected layout suggestions 5/10. Five remained unresolved. This is AI-provisional development evidence, not blind accuracy. Zero wrong-valid derived readings in this tiny set is not a safety guarantee.')
p('Original image hashes, raw OCR and correction history remain separate. A clipped-date parsing defect and an outward crop-rounding defect were corrected. No OCR gain is claimed from the crop fix.','SmallRC')

story.append(PageBreak())
p('TEAM WORK / REAL EVIDENCE REQUIRED','SmallRC')
p('A short, concrete field plan','TitleRC')
heading('1. Collect the declarations, not just the package front')
table([['Suggested collector','Assigned IDs','Status'],['Arif','PKG01-10','Proposed; not collected'],['Tharun','PKG11-20','Proposed; not collected'],['Banu','PKG21-30','Proposed; not collected']], [120,130,261])
p('For each new physical product, capture the full declaration panel, complete MRP heading/value, complete quantity heading/value/unit and manufactured/packed stamp with its heading. Combine only when one original photo already shows multiple declarations; do not collage originals. Keep the physical package.')
p('Include flat, glossy, curved, small-print, faint-stamp and multilingual examples. Preserve originals and source rights. Reserve products by SKU before tuning, for example 10 development and 20 evaluation products. The previous 24 public photos are AI-exposed and contain only 5 readable target slots out of 72; they are not a fresh blind benchmark.')
heading('2. Freeze independent answers before testing')
p('Two people independently label each evaluation photo without OCR outputs, catalogue answers or each other\'s answers. A third person adjudicates disagreements. Record unreadable/not-visible rather than guessing. Freeze source hashes, labels, exclusions and browser modes before the run. AI cannot impersonate either reviewer.')
heading('3. Time the entire task, including failures')
p('Proposed pilot: six new users, two physical packages each, both manual and NiyamLens methods, alternating which comes first. Use the supplied observer.html timer for capture, reading/OCR wait, corrections, measurement and report/export. Do not pause away waiting or discard failures. Export the JSON after every session.')
p('A different person must physically check each report before any time-saving calculation is accepted. The timer leaves qualityReview null. There are no completed human timings in this release.')
heading('4. Get qualified review')
p('Send the unsigned domain packet and five complete package reports to a qualified Legal Metrology practitioner. Ask for corrections to applicability, exemptions, typography and evidence sufficiency. Separately compare physical dimensions with independently measured references and documented uncertainty. A teammate account called officer is not government approval.')
p('<link href="https://github.com/DuvvuruDeepakReddy18/NiyamLens-SIH26034/blob/codex/managed-cloud-release/docs/VALIDATION_NEXT_ACTIONS.md" color="#007657">Detailed task sheet, timer link and review protocol</link>','SmallRC')

story.append(PageBreak())
p('PRESENTATION / FALSIFIABLE LIVE WORKFLOW','SmallRC')
p('Show what happens.\nKeep the limits visible.'.replace('\n','<br/>'),'TitleRC')
table([
 ['Time','Live action','What to explain'],
 ['0:00-1:15','Outsider chooses a new package; start Blind Challenge and upload panels','No prepared answer and no hidden fixture substitution'],
 ['1:15-2:45','Check capture, run actual OCR, open a source-linked reading','A confidence score is not measured accuracy'],
 ['2:45-4:25','Review fields, applicability and supported physical measurement','Show corrections explicitly; abstain when scope/scale is unresolved'],
 ['4:25-5:15','Trace two rule findings back to preserved evidence','Deterministic versioned checks; not an AI statutory accusation'],
 ['5:15-6:35','Finalize, show server acknowledgment and fresh retrieval/export','Local saved, queued and server acknowledged are different states'],
 ['6:35-7:00','Show the actual outcome and remaining validation gates','Do not force PASS or promise a win'],
], [82,224,205])
heading('Before the team presents')
p('Rehearse three times with an outsider and keep failed attempts. Include a disconnected-network trial with assets cached. Give every subsystem a primary and backup presenter. Use separately authorized accounts, never shared passwords. Old presentations may contain stale accuracy/test claims; check every number against this release.')
heading('Operational limits still open')
p('The retained rollback copy covers four database functions and execute grants only. It is <b>not</b> a full workspace, Auth or Storage backup, and no protected off-site disaster-recovery rehearsal was completed. Connected cloud OCR execution and email delivery are not established by this acceptance run. The hosted offline test used a still-valid session and previously completed OCR; expired-session behavior was exercised separately with mocked test identities.')
heading('Release trace')
p('Application commit: <b>d13aad50adedaa2c3a7d1c41bd036fe65bcb5b54</b><br/>Deployment: dpl_FPx8WbxZrukoGC3RijjaKiuRbc8q<br/>Public app module: /assets/index-E1tT8IDD.js','SmallRC')
p('<link href="'+r['ci']['url']+'" color="#007657">GitHub release verification</link> &nbsp; / &nbsp; <link href="https://github.com/DuvvuruDeepakReddy18/NiyamLens-SIH26034/blob/codex/managed-cloud-release/docs/RC6_RELEASE_2026-09-05.md" color="#007657">Detailed release report</link>','SmallRC')
p('No official 2026 judging rubric, submission deadline, departmental endorsement or likelihood of winning is certified by this document. Confirm current competition requirements with your college SPOC.','SmallRC')

if not check_only:
    SimpleDocTemplate(str(output),pagesize=A4,rightMargin=42,leftMargin=42,topMargin=38,bottomMargin=58,title='NiyamLens RC6 team handoff',author='Codex for the NiyamLens team').build(story,onFirstPage=footer,onLaterPages=footer)
reader = PdfReader(output)
assert len(reader.pages) == 3, f'Expected three intentional pages, found {len(reader.pages)}'
text = ' '.join(' '.join(page.extract_text() or '' for page in reader.pages).split())
for expected in ['1/10', '5/10', '603/603', 'qualityReview', 'not maximum-load stress']:
    assert expected in text, expected
preview = root / '.niyamlens-private/rc6-pdf-preview'
preview.mkdir(exist_ok=True)
pdf = pdfium.PdfDocument(str(output))
for i in range(len(pdf)):
    page = pdf[i]; page.render(scale=1.3).to_pil().save(preview / f'page-{i+1}.png'); page.close()
pdf.close()
print(json.dumps({'pdf':str(output),'pages':len(reader.pages),'textChecked':True,'previewDirectory':str(preview)}))

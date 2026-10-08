"""Build the downloadable prompt PDFs from prompts/*.txt (the same text the Prompts page copies).

Run from the repo root:  python3 tools/build-prompt-pdfs.py
Needs: pip install reportlab   (fonts: DejaVu, present on most Linux systems)
"""
import os, re
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle, KeepTogether
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

FONTS = '/usr/share/fonts/truetype/dejavu/'
pdfmetrics.registerFont(TTFont('Sans', FONTS + 'DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('Sans-Bold', FONTS + 'DejaVuSans-Bold.ttf'))
pdfmetrics.registerFont(TTFont('Mono', FONTS + 'DejaVuSansMono.ttf'))
pdfmetrics.registerFont(TTFont('Mono-Bold', FONTS + 'DejaVuSansMono-Bold.ttf'))

NAVY, BLUE, SKY, INK, MUTED, PAPER = colors.HexColor('#0a1a3a'), colors.HexColor('#1e7bff'), colors.HexColor('#7cc4ff'), colors.HexColor('#0f172a'), colors.HexColor('#5b6b86'), colors.HexColor('#f4f8ff')

PROMPTS = [
    ('story-master-prompt', 'Master Story Prompt', 'v3 · Import-Safe · Stories',
     'Generates a complete, original multi-character story in the YouTube Blue Script Format, ready to import into Story Studio with no cleanup.',
     ['Fill in the YOUR STORY box (or leave "you choose").', 'Copy the whole prompt into your AI (ChatGPT, Claude, Gemini…) and send it.',
      'Copy the AI\'s answer and paste it into Story Studio → Import. Characters, roles, scenes and lines are added automatically.']),
    ('character-creator-prompt', 'Character Creator Prompt', 'v1 · Import-Safe · Characters',
     'Designs a memorable, easy-to-voice cast with consistent looks. The CHARACTERS block imports straight into Story Studio, and the Character Bible gives you image prompts and voice settings.',
     ['Fill in the YOUR CAST box.', 'Copy the whole prompt into your AI and send it.',
      'Paste the answer into Story Studio → Import → "Add to this story". Reuse the same CHARACTERS block in the Master Story Prompt so every story keeps the cast.']),
]

def esc(t): return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

def build(slug, title, tag, blurb, steps, root='.'):
    src = open(os.path.join(root, 'prompts', slug + '.txt'), encoding='utf-8').read()
    body = src.split('────────────────────────────────────────', 1)[1].strip('\n')
    out = os.path.join(root, 'prompts', slug + '.pdf')

    def page(c, doc):
        c.saveState()
        w, h = letter
        c.setFillColor(NAVY); c.rect(0, h - 0.55 * inch, w, 0.55 * inch, stroke=0, fill=1)
        c.setFillColor(colors.white); c.setFont('Sans-Bold', 11); c.drawString(0.6 * inch, h - 0.35 * inch, 'YouTube')
        c.setFillColor(SKY); c.drawString(0.6 * inch + c.stringWidth('YouTube ', 'Sans-Bold', 11), h - 0.35 * inch, 'Blue')
        c.setFillColor(colors.HexColor('#c7d7f5')); c.setFont('Sans', 8.5); c.drawRightString(w - 0.6 * inch, h - 0.35 * inch, 'Prompts · ' + title)
        c.setFillColor(MUTED); c.setFont('Sans', 8); c.drawString(0.6 * inch, 0.45 * inch, 'Copy the prompt text exactly — the importer depends on its format.')
        c.drawRightString(w - 0.6 * inch, 0.45 * inch, 'Page %d' % doc.page)
        c.restoreState()

    doc = BaseDocTemplate(out, pagesize=letter, leftMargin=0.6 * inch, rightMargin=0.6 * inch, topMargin=0.85 * inch, bottomMargin=0.75 * inch,
                          title='YouTube Blue — ' + title, author='YouTube Blue', subject=blurb)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='p', frames=[frame], onPage=page)])

    H = ParagraphStyle('h', fontName='Sans-Bold', fontSize=22, leading=27, textColor=INK, spaceAfter=2)
    T = ParagraphStyle('t', fontName='Sans-Bold', fontSize=9, leading=12, textColor=BLUE, spaceAfter=8)
    P = ParagraphStyle('p', fontName='Sans', fontSize=10.5, leading=15, textColor=INK, spaceAfter=10)
    S = ParagraphStyle('s', fontName='Sans', fontSize=10, leading=14, textColor=INK)
    L = ParagraphStyle('l', fontName='Sans-Bold', fontSize=9, leading=12, textColor=MUTED, spaceBefore=6, spaceAfter=6)
    M = ParagraphStyle('m', fontName='Mono', fontSize=8.4, leading=11.2, textColor=INK, leftIndent=10, rightIndent=8, backColor=PAPER, borderPadding=0)
    MH = ParagraphStyle('mh', parent=M, fontName='Mono-Bold', textColor=colors.HexColor('#0b4fb3'))

    story = [Paragraph(esc(title), H), Paragraph(esc(tag.upper()), T), Paragraph(esc(blurb), P)]
    rows = [[Paragraph('<b>%d</b>' % (i + 1), ParagraphStyle('n', parent=S, textColor=colors.white, alignment=1)), Paragraph(esc(s), S)] for i, s in enumerate(steps)]
    tb = Table(rows, colWidths=[0.32 * inch, doc.width - 0.32 * inch - 0.3 * inch])
    tb.setStyle(TableStyle([('BACKGROUND', (0, 0), (0, -1), BLUE), ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
                            ('LINEBELOW', (1, 0), (1, -2), 0.5, colors.HexColor('#dbe6f7')), ('LEFTPADDING', (1, 0), (1, -1), 10)]))
    story += [Paragraph('HOW TO USE', L), tb, Spacer(1, 14), Paragraph('THE PROMPT — COPY EVERYTHING BELOW', L)]
    for line in body.split('\n'):
        lead = len(line) - len(line.lstrip(' '))
        txt = '&nbsp;' * lead + esc(line.strip()) if line.strip() else '&nbsp;'
        head = bool(re.match(r'^(=== .* ===|[A-Z][A-Z /&—()0-9.\-]{5,}$|TITLE:)', line.strip()))
        story.append(Paragraph(txt, MH if head else M))
    doc.build(story)
    return out

if __name__ == '__main__':
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for p in PROMPTS: print('built', build(*p, root=root))

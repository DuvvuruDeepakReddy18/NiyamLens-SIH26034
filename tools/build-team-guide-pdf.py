from __future__ import annotations

import html
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.fonts import addMapping
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    ListFlowable,
    ListItem,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Preformatted,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "TEAM_FEATURE_VERIFICATION_GUIDE.md"
OUTPUT = ROOT / "docs" / "NiyamLens_Team_Feature_Verification_Guide.pdf"

INK = colors.HexColor("#102A33")
TEAL = colors.HexColor("#00A37A")
TEAL_DARK = colors.HexColor("#007A5C")
AMBER = colors.HexColor("#E0A320")
RED = colors.HexColor("#C6493D")
PAPER = colors.HexColor("#F7F4EC")
CREAM = colors.HexColor("#FFFDF6")
MIST = colors.HexColor("#E7EEEC")
SLATE = colors.HexColor("#49616A")
LINE = colors.HexColor("#C9D5D2")


def register_fonts() -> None:
    fonts = Path("C:/Windows/Fonts")
    pdfmetrics.registerFont(TTFont("Niyam", fonts / "segoeui.ttf"))
    pdfmetrics.registerFont(TTFont("Niyam-Semibold", fonts / "seguisb.ttf"))
    pdfmetrics.registerFont(TTFont("Niyam-Bold", fonts / "segoeuib.ttf"))
    pdfmetrics.registerFont(TTFont("Niyam-Mono", fonts / "consola.ttf"))
    addMapping("Niyam", 0, 0, "Niyam")
    addMapping("Niyam", 1, 0, "Niyam-Bold")


register_fonts()


class GuideDocument(BaseDocTemplate):
    def __init__(self, filename: str):
        super().__init__(
            filename,
            pagesize=A4,
            leftMargin=17 * mm,
            rightMargin=17 * mm,
            topMargin=19 * mm,
            bottomMargin=18 * mm,
            title="NiyamLens Team Feature and Verification Guide",
            author="Team NiyamLens",
            subject="SIH26034 competition prototype feature and verification handbook",
            creator="NiyamLens documentation build",
        )
        body_frame = Frame(
            self.leftMargin,
            self.bottomMargin,
            self.width,
            self.height,
            id="body-frame",
            leftPadding=0,
            rightPadding=0,
            topPadding=0,
            bottomPadding=0,
        )
        cover_frame = Frame(
            20 * mm,
            18 * mm,
            A4[0] - 40 * mm,
            A4[1] - 36 * mm,
            id="cover-frame",
            leftPadding=0,
            rightPadding=0,
            topPadding=0,
            bottomPadding=0,
        )
        self.addPageTemplates(
            [
                PageTemplate(id="cover", frames=[cover_frame], onPage=draw_cover),
                PageTemplate(id="body", frames=[body_frame], onPage=draw_body),
            ]
        )

    def afterFlowable(self, flowable):
        style_name = getattr(getattr(flowable, "style", None), "name", "")
        if style_name not in {"GuideH1", "GuideH2"}:
            return
        level = 0 if style_name == "GuideH1" else 1
        text = flowable.getPlainText()
        key = f"section-{self.page}-{abs(hash((text, self.page)))}"
        self.canv.bookmarkPage(key)
        self.canv.addOutlineEntry(text, key, level=level, closed=False)
        self.notify("TOCEntry", (level, text, self.page, key))


def draw_cover(canvas, doc):
    width, height = A4
    canvas.saveState()
    canvas.setFillColor(PAPER)
    canvas.rect(0, 0, width, height, fill=1, stroke=0)
    canvas.setFillColor(INK)
    canvas.rect(0, height - 52 * mm, width, 52 * mm, fill=1, stroke=0)
    canvas.setFillColor(TEAL)
    canvas.rect(0, height - 6 * mm, width, 6 * mm, fill=1, stroke=0)
    canvas.setFillColor(TEAL)
    canvas.circle(29 * mm, height - 29 * mm, 10 * mm, fill=1, stroke=0)
    canvas.setFillColor(CREAM)
    canvas.circle(29 * mm, height - 29 * mm, 6.2 * mm, fill=1, stroke=0)
    canvas.setFillColor(INK)
    canvas.setFont("Niyam-Bold", 16)
    canvas.drawCentredString(29 * mm, height - 31.2 * mm, "N")
    canvas.setFillColor(CREAM)
    canvas.setFont("Niyam-Semibold", 12)
    canvas.drawString(45 * mm, height - 27 * mm, "NIYAMLENS")
    canvas.setFont("Niyam", 8)
    canvas.drawString(45 * mm, height - 33 * mm, "EVIDENCE BEFORE VERDICT")
    canvas.setFillColor(INK)
    canvas.setFont("Niyam", 8)
    canvas.drawString(20 * mm, 12 * mm, "SIH26034  /  TEAM EDITION  /  1 SEPTEMBER 2026")
    canvas.setFillColor(TEAL)
    canvas.rect(176 * mm, 11.5 * mm, 14 * mm, 1.2 * mm, fill=1, stroke=0)
    canvas.restoreState()


def draw_body(canvas, doc):
    width, height = A4
    canvas.saveState()
    canvas.setFillColor(CREAM)
    canvas.rect(0, 0, width, height, fill=1, stroke=0)
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.5)
    canvas.line(doc.leftMargin, height - 12 * mm, width - doc.rightMargin, height - 12 * mm)
    canvas.setFillColor(INK)
    canvas.setFont("Niyam-Semibold", 8)
    canvas.drawString(doc.leftMargin, height - 9 * mm, "NIYAMLENS")
    canvas.setFillColor(SLATE)
    canvas.setFont("Niyam", 7.5)
    canvas.drawRightString(width - doc.rightMargin, height - 9 * mm, "SIH26034 · FEATURE & VERIFICATION GUIDE")
    canvas.setStrokeColor(LINE)
    canvas.line(doc.leftMargin, 12 * mm, width - doc.rightMargin, 12 * mm)
    canvas.setFillColor(SLATE)
    canvas.setFont("Niyam", 7.5)
    canvas.drawString(doc.leftMargin, 8 * mm, "Decision-support prototype · Officer verification required")
    canvas.setFillColor(INK)
    canvas.setFont("Niyam-Semibold", 8)
    canvas.drawRightString(width - doc.rightMargin, 8 * mm, f"{canvas.getPageNumber():02d}")
    canvas.restoreState()


base = getSampleStyleSheet()
STYLES = {
    "cover-kicker": ParagraphStyle(
        "CoverKicker",
        parent=base["Normal"],
        fontName="Niyam-Semibold",
        fontSize=9,
        leading=12,
        textColor=TEAL_DARK,
        spaceAfter=7 * mm,
        tracking=1.4,
    ),
    "cover-title": ParagraphStyle(
        "CoverTitle",
        parent=base["Title"],
        fontName="Niyam-Bold",
        fontSize=31,
        leading=34,
        textColor=INK,
        alignment=TA_LEFT,
        spaceAfter=6 * mm,
    ),
    "cover-subtitle": ParagraphStyle(
        "CoverSubtitle",
        parent=base["Normal"],
        fontName="Niyam",
        fontSize=13,
        leading=19,
        textColor=SLATE,
        spaceAfter=10 * mm,
    ),
    "cover-meta": ParagraphStyle(
        "CoverMeta",
        parent=base["Normal"],
        fontName="Niyam",
        fontSize=9,
        leading=14,
        textColor=SLATE,
        alignment=TA_CENTER,
    ),
    "h1": ParagraphStyle(
        "GuideH1",
        parent=base["Heading1"],
        fontName="Niyam-Bold",
        fontSize=18,
        leading=22,
        textColor=INK,
        spaceBefore=8 * mm,
        spaceAfter=3.2 * mm,
        keepWithNext=True,
    ),
    "h2": ParagraphStyle(
        "GuideH2",
        parent=base["Heading2"],
        fontName="Niyam-Bold",
        fontSize=12,
        leading=15,
        textColor=TEAL_DARK,
        spaceBefore=5.5 * mm,
        spaceAfter=2.3 * mm,
        keepWithNext=True,
    ),
    "h3": ParagraphStyle(
        "GuideH3",
        parent=base["Heading3"],
        fontName="Niyam-Semibold",
        fontSize=10,
        leading=13,
        textColor=INK,
        spaceBefore=4 * mm,
        spaceAfter=1.8 * mm,
        keepWithNext=True,
    ),
    "body": ParagraphStyle(
        "GuideBody",
        parent=base["BodyText"],
        fontName="Niyam",
        fontSize=8.6,
        leading=12.2,
        textColor=INK,
        spaceAfter=2.1 * mm,
        allowWidows=0,
        allowOrphans=0,
    ),
    "small": ParagraphStyle(
        "GuideSmall",
        parent=base["BodyText"],
        fontName="Niyam",
        fontSize=7.3,
        leading=9.5,
        textColor=INK,
    ),
    "table-header": ParagraphStyle(
        "GuideTableHeader",
        parent=base["BodyText"],
        fontName="Niyam-Semibold",
        fontSize=7.5,
        leading=9.5,
        textColor=colors.white,
    ),
    "list": ParagraphStyle(
        "GuideList",
        parent=base["BodyText"],
        fontName="Niyam",
        fontSize=8.4,
        leading=11.5,
        textColor=INK,
        leftIndent=1 * mm,
        spaceAfter=0.8 * mm,
    ),
    "code": ParagraphStyle(
        "GuideCode",
        parent=base["Code"],
        fontName="Niyam-Mono",
        fontSize=7.1,
        leading=9.4,
        textColor=INK,
        leftIndent=2 * mm,
        rightIndent=2 * mm,
    ),
    "toc-title": ParagraphStyle(
        "TocTitle",
        parent=base["Heading1"],
        fontName="Niyam-Bold",
        fontSize=21,
        leading=25,
        textColor=INK,
        spaceAfter=6 * mm,
    ),
}


def inline_markup(text: str) -> str:
    placeholders: dict[str, str] = {}

    def hold(fragment: str) -> str:
        key = f"@@HOLD{len(placeholders)}@@"
        placeholders[key] = fragment
        return key

    text = re.sub(
        r"\[([^\]]+)\]\(([^)]+)\)",
        lambda match: hold(
            f'<link href="{html.escape(match.group(2), quote=True)}" color="#007A5C"><u>{html.escape(match.group(1))}</u></link>'
        ) if re.match(r"https?://", match.group(2)) else hold(f"<b>{html.escape(match.group(1))}</b>"),
        text,
    )
    text = re.sub(
        r"<((?:https?://)[^>]+)>",
        lambda match: hold(
            f'<link href="{html.escape(match.group(1), quote=True)}" color="#007A5C"><u>{html.escape(match.group(1))}</u></link>'
        ),
        text,
    )
    text = re.sub(
        r"`([^`]+)`",
        lambda match: hold(f'<font name="Niyam-Mono" color="#49616A">{html.escape(match.group(1))}</font>'),
        text,
    )
    text = html.escape(text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<i>\1</i>", text)
    text = text.replace("²", "<super>2</super>")
    text = text.replace("→", "&#8594;")
    for key, value in placeholders.items():
        text = text.replace(key, value)
    return text


def make_table(rows: list[list[str]], available_width: float) -> Table:
    column_count = max(len(row) for row in rows)
    padded = [row + [""] * (column_count - len(row)) for row in rows]
    lengths = []
    for index in range(column_count):
        maximum = max(len(re.sub(r"[*`]", "", row[index])) for row in padded)
        lengths.append(max(7, min(maximum, 38)))
    raw_widths = [length ** 0.62 for length in lengths]
    scale = available_width / sum(raw_widths)
    widths = [value * scale for value in raw_widths]
    cells = [
        [Paragraph(inline_markup(cell), STYLES["table-header"] if row_index == 0 else STYLES["small"]) for cell in row]
        for row_index, row in enumerate(padded)
    ]
    table = Table(cells, colWidths=widths, repeatRows=1, hAlign="LEFT")
    commands = [
        ("BACKGROUND", (0, 0), (-1, 0), INK),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Niyam-Semibold"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.35, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    for row_index in range(1, len(cells)):
        commands.append(("BACKGROUND", (0, row_index), (-1, row_index), CREAM if row_index % 2 else MIST))
    table.setStyle(TableStyle(commands))
    return table


def markdown_story(markdown_text: str, available_width: float):
    lines = markdown_text.splitlines()
    story = []
    paragraph_lines: list[str] = []
    index = 0

    def flush_paragraph():
        nonlocal paragraph_lines
        if paragraph_lines:
            story.append(Paragraph(inline_markup(" ".join(paragraph_lines)), STYLES["body"]))
            paragraph_lines = []

    while index < len(lines):
        raw = lines[index].rstrip()
        stripped = raw.strip()

        if not stripped:
            flush_paragraph()
            index += 1
            continue

        if stripped.startswith("```"):
            flush_paragraph()
            code_lines = []
            index += 1
            while index < len(lines) and not lines[index].strip().startswith("```"):
                code_lines.append(lines[index].rstrip())
                index += 1
            index += 1
            code = Preformatted("\n".join(code_lines), STYLES["code"])
            wrapper = Table([[code]], colWidths=[available_width])
            wrapper.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), MIST),
                ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]))
            story.extend([wrapper, Spacer(1, 2.5 * mm)])
            continue

        if stripped.startswith("|") and stripped.endswith("|"):
            flush_paragraph()
            table_lines = []
            while index < len(lines):
                candidate = lines[index].strip()
                if not (candidate.startswith("|") and candidate.endswith("|")):
                    break
                table_lines.append(candidate)
                index += 1
            rows = []
            for table_line in table_lines:
                cells = [cell.strip() for cell in table_line.strip("|").split("|")]
                if all(re.fullmatch(r":?-{3,}:?", cell.replace(" ", "")) for cell in cells):
                    continue
                rows.append(cells)
            if rows:
                story.extend([make_table(rows, available_width), Spacer(1, 3 * mm)])
            continue

        heading = re.match(r"^(#{1,4})\s+(.+)$", stripped)
        if heading:
            flush_paragraph()
            level = len(heading.group(1))
            title = heading.group(2)
            if level == 1:
                index += 1
                continue
            style = STYLES["h1"] if level == 2 else STYLES["h2"] if level == 3 else STYLES["h3"]
            story.append(Paragraph(inline_markup(title), style))
            index += 1
            continue

        list_match = re.match(r"^(\s*)([-*]|\d+\.)\s+(.*)$", raw)
        if list_match:
            flush_paragraph()
            ordered = list_match.group(2).endswith(".") and list_match.group(2)[0].isdigit()
            checkbox_list = bool(re.match(r"^\[ \]\s*", list_match.group(3)))
            entries = []
            while index < len(lines):
                item_match = re.match(r"^(\s*)([-*]|\d+\.)\s+(.*)$", lines[index].rstrip())
                if not item_match:
                    break
                item_ordered = item_match.group(2).endswith(".") and item_match.group(2)[0].isdigit()
                if item_ordered != ordered:
                    break
                value = item_match.group(3)
                value = re.sub(r"^\[ \]\s*", "□ ", value)
                entries.append(ListItem(Paragraph(inline_markup(value), STYLES["list"]), leftIndent=4 * mm))
                index += 1
            list_options = {
                "bulletType": "1" if ordered else "bullet",
                "bulletFontName": "Niyam-Semibold",
                "bulletFontSize": 7.5,
                "bulletColor": CREAM if checkbox_list else TEAL_DARK,
                "leftIndent": 5 * mm,
                "bulletOffsetY": 1,
                "spaceAfter": 2.2 * mm,
            }
            if ordered:
                list_options["start"] = "1"
            flow = ListFlowable(entries, **list_options)
            story.append(flow)
            continue

        paragraph_lines.append(stripped)
        index += 1

    flush_paragraph()
    return story


def cover_story():
    stat_style = ParagraphStyle(
        "Stat",
        parent=STYLES["cover-meta"],
        fontName="Niyam-Bold",
        fontSize=19,
        leading=22,
        textColor=INK,
    )
    stat_label = ParagraphStyle(
        "StatLabel",
        parent=STYLES["cover-meta"],
        fontName="Niyam-Semibold",
        fontSize=7.5,
        leading=10,
        textColor=SLATE,
    )
    stat_cells = []
    for number, label in [("29", "FEATURES"), ("44/44", "TESTS PASS"), ("4", "OCR MODES"), ("YES", "OFFLINE OCR")]:
        stat_cells.append([Paragraph(number, stat_style), Paragraph(label, stat_label)])
    stats = Table([stat_cells], colWidths=[(A4[0] - 40 * mm) / 4] * 4)
    stats.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CREAM),
        ("BOX", (0, 0), (-1, -1), 0.6, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    live = inline_markup("**Live prototype:** <https://niyamlens-sih26034.vercel.app>")
    source = inline_markup("**Source:** <https://github.com/DuvvuruDeepakReddy18/NiyamLens-SIH26034>")
    return [
        Spacer(1, 48 * mm),
        Paragraph("SIH26034 · TEAM HANDBOOK", STYLES["cover-kicker"]),
        Paragraph("Feature &<br/>Verification Guide", STYLES["cover-title"]),
        Paragraph(
            "A practical runbook for demonstrating, testing and defending the NiyamLens packaged-commodity inspection prototype.",
            STYLES["cover-subtitle"],
        ),
        stats,
        Spacer(1, 10 * mm),
        Paragraph(live, STYLES["cover-meta"]),
        Paragraph(source, STYLES["cover-meta"]),
        Spacer(1, 6 * mm),
        Paragraph("Release 0.2.1 · Verified 1 September 2026 · Private source repository", STYLES["cover-meta"]),
        NextPageTemplate("body"),
        PageBreak(),
    ]


def toc_story():
    toc = TableOfContents()
    toc.levelStyles = [
        ParagraphStyle(
            "TOC1",
            fontName="Niyam-Semibold",
            fontSize=9,
            leading=13,
            leftIndent=0,
            firstLineIndent=0,
            textColor=INK,
            spaceBefore=2,
        ),
        ParagraphStyle(
            "TOC2",
            fontName="Niyam",
            fontSize=8,
            leading=11,
            leftIndent=6 * mm,
            firstLineIndent=0,
            textColor=SLATE,
        ),
    ]
    return [
        Paragraph("Contents", STYLES["toc-title"]),
        Paragraph(
            "Use this handbook as the team's shared source of truth. Every feature is paired with a reproducible proof and a clear claim boundary.",
            STYLES["body"],
        ),
        Spacer(1, 3 * mm),
        toc,
        PageBreak(),
    ]


def build():
    markdown = SOURCE.read_text(encoding="utf-8")
    document = GuideDocument(str(OUTPUT))
    story = cover_story() + toc_story() + markdown_story(markdown, document.width)
    document.multiBuild(story)
    print(f"Created {OUTPUT}")


if __name__ == "__main__":
    build()

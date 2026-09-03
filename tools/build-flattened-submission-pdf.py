from pathlib import Path

from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parent.parent
SLIDES = ROOT / "docs" / "submission-slides"
OUTPUT = ROOT / "docs" / "NiyamLens_SIH26034_Ready_to_Submit.pdf"
PAGE_SIZE = (960, 540)


def main() -> None:
    images = [SLIDES / f"slide-{number}.png" for number in range(1, 7)]
    missing = [str(image) for image in images if not image.exists()]
    if missing:
        raise FileNotFoundError(f"Missing rendered slide image(s): {missing}")

    pdf = canvas.Canvas(str(OUTPUT), pagesize=PAGE_SIZE, pageCompression=1)
    pdf.setTitle("NiyamLens — SIH26034")
    pdf.setAuthor("Team NiyamLens")
    pdf.setSubject("SIH 2026 idea submission using the official six-slide template")
    for image in images:
        pdf.drawImage(ImageReader(str(image)), 0, 0, width=PAGE_SIZE[0], height=PAGE_SIZE[1])
        pdf.showPage()
    pdf.save()
    print(f"Created {OUTPUT}")


if __name__ == "__main__":
    main()

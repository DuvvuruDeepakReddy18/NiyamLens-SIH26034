const svgData = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

const escapeXml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')

const labelSvg = ({ name, subtitle, accent, lines, marker = true }) => svgData(`
  <svg xmlns="http://www.w3.org/2000/svg" width="900" height="1120" viewBox="0 0 900 1120">
    <defs>
      <linearGradient id="pack" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stop-color="#102a33"/>
        <stop offset="1" stop-color="#234b57"/>
      </linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="18" stdDeviation="18" flood-opacity=".22"/>
      </filter>
    </defs>
    <rect width="900" height="1120" fill="#e7e2d5"/>
    <g filter="url(#shadow)">
      <path d="M120 70h660l42 96-34 862H112L78 166z" fill="url(#pack)"/>
      <path d="M120 70h660l42 96H78z" fill="${accent}" opacity=".95"/>
      <circle cx="450" cy="322" r="174" fill="#fffdf6"/>
      <circle cx="450" cy="322" r="148" fill="none" stroke="${accent}" stroke-width="10"/>
      <circle cx="450" cy="224" r="19" fill="${accent}" opacity=".12"/>
      <path d="M441 226c11-20 29-21 29-21-1 17-11 29-29 21Zm0 0c-8-12-20-14-20-14 1 12 8 19 20 14Z" fill="${accent}"/>
      <text x="450" y="286" text-anchor="middle" font-family="Georgia,serif" font-size="${name.length > 10 ? 34 : 50}" font-weight="700" letter-spacing="${name.length > 10 ? .5 : 2}" fill="#102a33">${escapeXml(name)}</text>
      <path d="M350 318h200" stroke="${accent}" stroke-width="3" stroke-linecap="round" opacity=".7"/>
      <text x="450" y="358" text-anchor="middle" font-family="Arial,sans-serif" font-size="23" font-weight="700" letter-spacing="3" fill="${accent}">${escapeXml(subtitle)}</text>
      <text x="450" y="405" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" letter-spacing="2" fill="#49616a">DEMO PACKAGE</text>
      <rect x="154" y="540" width="592" height="392" rx="18" fill="#fffdf6"/>
      ${lines.map((line, index) => `<text x="192" y="${604 + index * 48}" font-family="Arial,sans-serif" font-size="${line.small ? 17 : 25}" font-weight="${line.bold ? 700 : 400}" fill="${line.red ? '#c6493d' : '#102a33'}">${escapeXml(line.text)}</text>`).join('')}
      ${marker ? '<rect x="604" y="965" width="120" height="22" rx="4" fill="#00a37a"/><text x="664" y="1014" text-anchor="middle" font-family="Arial" font-size="18" fill="#fffdf6">20 mm REF</text>' : ''}
    </g>
  </svg>
`)

export const DEMOS = {
  risky: {
    label: 'Load violation demo',
    fileName: 'demo-herbal-shampoo.svg',
    imageUrl: labelSvg({
      name: 'VERDANT',
      subtitle: 'HERBAL SHAMPOO',
      accent: '#e0a320',
      lines: [
        { text: 'MRP Rs. 2.00 (inclusive of all taxes)', bold: true },
        { text: 'NET QTY 20 ml', bold: true },
        { text: 'PACKED 08/2026' },
        { text: 'MANUFACTURED BY: VERDANT CARE PVT LTD' },
        { text: 'Chennai, Tamil Nadu 600119', small: true },
        { text: 'Consumer contact not printed', red: true, small: true },
      ],
    }),
    text: `VERDANT HERBAL SHAMPOO
MRP Rs. 2.00 (inclusive of all taxes)
NET QTY 20 ml
PACKED 08/2026
MANUFACTURED BY: VERDANT CARE PVT LTD
Chennai, Tamil Nadu 600119`,
    meta: {
      productName: 'Verdant Herbal Shampoo',
      category: 'general',
      quantity: 20,
      unit: 'ml',
      pdpArea: 75,
      pdpUncertainty: 6,
      formedText: false,
      referenceMm: 20,
      referencePx: 120,
      glyphPx: 7,
      glyphWidthPx: 2,
      measurementUncertainty: 8,
      ocrConfidence: 92,
    },
  },
  compliant: {
    label: 'Load compliant demo',
    fileName: 'demo-turmeric-powder.svg',
    imageUrl: labelSvg({
      name: 'ROOT & RAIN',
      subtitle: 'TURMERIC POWDER',
      accent: '#00a37a',
      lines: [
        { text: 'MRP Rs. 40.00 (inclusive of all taxes)', bold: true },
        { text: 'NET QTY 100 g', bold: true },
        { text: 'PACKED 08/2026' },
        { text: 'MANUFACTURED BY: ROOT & RAIN FOODS' },
        { text: 'CONSUMER CARE: ROOT & RAIN HELPDESK' },
        { text: '12 Market Road, Chennai 600001', small: true },
        { text: '1800 000 2026 · care@rootrain.in', small: true },
      ],
    }),
    text: `ROOT & RAIN TURMERIC POWDER
MRP Rs. 40.00 (inclusive of all taxes)
NET QTY 100 g
PACKED 08/2026
MANUFACTURED BY: ROOT & RAIN FOODS
CONSUMER CARE: ROOT & RAIN HELPDESK
12 Market Road, Chennai 600001
Helpline: 1800 000 2026 · care@rootrain.in`,
    meta: {
      productName: 'Root & Rain Turmeric Powder',
      category: 'food',
      quantity: 100,
      unit: 'g',
      pdpArea: 80,
      pdpUncertainty: 4,
      formedText: false,
      referenceMm: 20,
      referencePx: 120,
      glyphPx: 11,
      glyphWidthPx: 4.2,
      measurementUncertainty: 6,
      ocrConfidence: 96,
    },
  },
  exempt: {
    label: 'Load exemption test',
    fileName: 'demo-small-shampoo.svg',
    imageUrl: labelSvg({
      name: 'VERDANT',
      subtitle: 'HERBAL SHAMPOO',
      accent: '#4b8bd8',
      lines: [
        { text: 'NET QTY 8 ml', bold: true },
        { text: 'SMALL-PACK RULE TEST', bold: true },
        { text: 'Non-tobacco commodity profile' },
      ],
    }),
    text: `VERDANT HERBAL SHAMPOO
NET QTY 8 ml
SMALL-PACK RULE TEST
Non-tobacco commodity profile`,
    meta: {
      productName: 'Verdant Herbal Shampoo',
      category: 'general',
      commodityClass: 'standard',
      quantity: 8,
      unit: 'ml',
      ocrConfidence: 96,
    },
  },
}

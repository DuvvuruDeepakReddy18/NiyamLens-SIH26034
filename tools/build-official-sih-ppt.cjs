const fs = require('fs')
const path = require('path')
const PptxGenJS = require('pptxgenjs')

const ROOT = path.resolve(__dirname, '..')
const DOCS = path.join(ROOT, 'docs')
const TEMPLATE_RENDER = path.join(DOCS, 'index-reference')
const ASSETS = path.join(DOCS, 'sih-template-assets')
const OUTPUT = path.join(DOCS, 'NiyamLens_SIH26034_Official_SIH_Template.pptx')

const C = {
  blue: '0B78B8',
  blueDark: '235A8B',
  bluePale: 'E7F2FA',
  orange: 'F58220',
  orangePale: 'FDE9D7',
  green: '138B49',
  greenPale: 'E3F3E9',
  purple: '8064A2',
  red: 'D51F26',
  black: '111111',
  gray: '5E6870',
  paleGray: 'EFF2F3',
  line: '5F6A70',
  white: 'FFFFFF',
}

const pptx = new PptxGenJS()
pptx.layout = 'LAYOUT_WIDE'
pptx.author = 'Team NiyamLens'
pptx.company = 'NiyamLens'
pptx.subject = 'SIH 2026 idea submission for SIH26034'
pptx.title = 'NiyamLens — SIH26034'
pptx.lang = 'en-IN'
pptx.theme = {
  headFontFace: 'Cambria',
  bodyFontFace: 'Arial',
  lang: 'en-IN',
}

function addText(slide, text, x, y, w, h, opts = {}) {
  slide.addText(text, {
    x, y, w, h,
    fontFace: opts.fontFace || 'Arial',
    fontSize: opts.fontSize || 15,
    color: opts.color || C.black,
    bold: Boolean(opts.bold),
    italic: Boolean(opts.italic),
    align: opts.align || 'left',
    valign: opts.valign || 'mid',
    margin: opts.margin === undefined ? 0 : opts.margin,
    fit: 'shrink',
    ...opts,
  })
}

function addRichText(slide, runs, x, y, w, h, opts = {}) {
  slide.addText(runs, {
    x, y, w, h,
    fontFace: opts.fontFace || 'Arial',
    fontSize: opts.fontSize || 14,
    color: opts.color || C.black,
    valign: opts.valign || 'top',
    margin: opts.margin === undefined ? 0 : opts.margin,
    fit: 'shrink',
    ...opts,
  })
}

function addFooter(slide, page) {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 7.03, w: 13.333, h: 0.47,
    fill: { color: C.blue }, line: { color: C.blue },
  })
  addText(slide, '@SIH Idea submission- Template', 4.2, 7.09, 4.95, 0.25, {
    fontSize: 10.5, color: C.white, align: 'center',
  })
  addText(slide, String(page), 12.33, 7.08, 0.35, 0.25, {
    fontSize: 10.5, bold: true, color: C.white, align: 'center',
  })
}

function addTeamMark(slide) {
  slide.addShape(pptx.ShapeType.ellipse, {
    x: 0.34, y: 0.04, w: 1.43, h: 0.94,
    fill: { color: C.white }, line: { color: C.purple, width: 1.4 },
  })
  addText(slide, 'NiyamLens', 0.47, 0.31, 1.17, 0.26, {
    fontSize: 12.5, bold: true, color: C.black, align: 'center',
  })
}

function addSihLogo(slide) {
  slide.addImage({ path: path.join(ASSETS, 'sih-2026-logo.png'), x: 10.62, y: 0.02, w: 2.48, h: 0.97 })
}

function addSectionChrome(slide, title, page) {
  slide.background = { color: C.white }
  addText(slide, title, 2.0, 0.08, 9.05, 0.64, {
    fontFace: 'Cambria', fontSize: 28, bold: true, color: C.black, align: 'center',
  })
  addFooter(slide, page)
}

function addSectionLabel(slide, label) {
  slide.addShape(pptx.ShapeType.diamond, {
    x: 0.17, y: 0.9, w: 0.23, h: 0.23,
    fill: { color: C.blueDark }, line: { color: C.blueDark },
  })
  addText(slide, label, 0.48, 0.83, 8.6, 0.4, {
    fontSize: 21.5, bold: true, color: C.blueDark, underline: { color: C.blueDark },
  })
}

function addPanel(slide, x, y, w, h, opts = {}) {
  slide.addShape(opts.rounded ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
    x, y, w, h,
    fill: { color: opts.fill || C.white, transparency: opts.transparency || 0 },
    line: { color: opts.line || C.line, width: opts.width || 1 },
    radius: opts.radius || 0.08,
    shadow: opts.shadow ? { type: 'outer', color: '777777', opacity: 0.15, blur: 1.5, angle: 45, distance: 1 } : undefined,
  })
}

function addBullet(slide, title, body, x, y, w, color = C.blueDark, size = 13.5, h = 0.62) {
  slide.addShape(pptx.ShapeType.ellipse, {
    x, y: y + 0.08, w: 0.13, h: 0.13,
    fill: { color }, line: { color },
  })
  const runs = title
    ? [
        { text: `${title}: `, options: { bold: true, color: C.black } },
        { text: body, options: { color: C.gray } },
      ]
    : [{ text: body, options: { color: C.black } }]
  addRichText(slide, runs, x + 0.22, y, w - 0.22, h, { fontSize: size })
}

function addStepBox(slide, number, title, body, x, y, w, accent) {
  addPanel(slide, x, y, w, 1.35, { fill: C.white, line: accent, width: 1.25, rounded: true })
  slide.addShape(pptx.ShapeType.ellipse, {
    x: x + 0.08, y: y + 0.08, w: 0.34, h: 0.34,
    fill: { color: accent }, line: { color: accent },
  })
  addText(slide, number, x + 0.08, y + 0.13, 0.34, 0.16, { fontSize: 8, bold: true, color: C.white, align: 'center' })
  addText(slide, title, x + 0.13, y + 0.51, w - 0.26, 0.25, { fontSize: 11.5, bold: true, color: C.black, align: 'center' })
  addText(slide, body, x + 0.13, y + 0.79, w - 0.26, 0.42, { fontSize: 9.3, color: C.gray, align: 'center', valign: 'top' })
}

function addMetric(slide, value, label, x, w, accent) {
  addPanel(slide, x, 1.07, w, 0.88, { fill: C.white, line: accent, width: 1.25, rounded: true })
  addText(slide, value, x + 0.12, 1.17, w - 0.24, 0.34, { fontFace: 'Cambria', fontSize: 20, bold: true, color: accent, align: 'center' })
  addText(slide, label, x + 0.12, 1.53, w - 0.24, 0.28, { fontSize: 8.4, bold: true, color: C.black, align: 'center' })
}

async function whiteToTransparent(input, output, extract, aggressiveNeutral = false) {
  const result = await sharp(input).extract(extract).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { data, info } = result
  for (let i = 0; i < data.length; i += 4) {
    const min = Math.min(data[i], data[i + 1], data[i + 2])
    const max = Math.max(data[i], data[i + 1], data[i + 2])
    if (aggressiveNeutral && max - min < 9 && min > 205) data[i + 3] = 0
    else if (min > 246) data[i + 3] = 0
    else if (min > 228) data[i + 3] = Math.max(0, Math.min(255, (246 - min) * 14))
  }
  await sharp(data, { raw: info }).png().toFile(output)
}

async function prepareAssets() {
  fs.mkdirSync(ASSETS, { recursive: true })
  const preparedAssets = [
    path.join(ASSETS, 'sih-2026-logo.png'),
    path.join(ASSETS, 'sih-2026-watermark.png'),
    path.join(ASSETS, 'ocr-verdict-wide.png'),
  ]
  if (preparedAssets.every((asset) => fs.existsSync(asset))) return

  let sharp
  try {
    sharp = require('sharp')
  } catch {
    throw new Error('Missing generated SIH assets. Restore docs/sih-template-assets or install optional dependency `sharp` to rebuild them.')
  }
  const templatePage = path.join(TEMPLATE_RENDER, 'index-slide-1.jpg')
  await Promise.all([
    whiteToTransparent(templatePage, path.join(ASSETS, 'sih-2026-logo.png'), { left: 1530, top: 0, width: 390, height: 185 }),
    whiteToTransparent(templatePage, path.join(ASSETS, 'sih-2026-watermark.png'), { left: 1100, top: 290, width: 460, height: 630 }, true),
    sharp(path.join(ROOT, 'qa-desktop-violation.png'))
      .extract({ left: 120, top: 1300, width: 1240, height: 800 })
      .png()
      .toFile(path.join(ASSETS, 'ocr-verdict-wide.png')),
  ])
}

function addTitleSlide() {
  const slide = pptx.addSlide()
  slide.background = { color: C.white }
  addText(slide, 'SMART INDIA HACKATHON 2026', 1.45, 0.12, 8.95, 0.62, {
    fontFace: 'Cambria', fontSize: 31.5, bold: true, color: C.blueDark, align: 'center',
  })
  addSihLogo(slide)

  slide.addShape(pptx.ShapeType.hexagon, {
    x: 8.0, y: 1.15, w: 4.25, h: 5.42,
    fill: { color: 'EEEEEE' }, line: { color: 'EEEEEE' },
  })
  slide.addShape(pptx.ShapeType.hexagon, {
    x: 6.92, y: 1.05, w: 2.05, h: 2.4,
    fill: { color: C.white, transparency: 100 }, line: { color: 'E9E9E9', width: 4 },
  })
  slide.addShape(pptx.ShapeType.hexagon, {
    x: 6.15, y: 4.28, w: 1.12, h: 1.42,
    fill: { color: 'ECECEC' }, line: { color: 'ECECEC' },
  })
  slide.addImage({ path: path.join(ASSETS, 'sih-2026-watermark.png'), x: 7.96, y: 1.98, w: 3.2, h: 4.38 })

  addText(slide, 'NIYAMLENS', 0.66, 1.15, 6.1, 0.57, {
    fontFace: 'Cambria', fontSize: 30, bold: true, color: C.black,
  })
  addText(slide, 'Evidence-grade packaged commodity inspection', 0.68, 1.73, 6.1, 0.35, {
    fontSize: 15, italic: true, color: C.blueDark,
  })

  const rows = [
    ['Problem Statement ID', 'SIH26034'],
    ['Problem Statement Title', 'Software System to check compliance of Packaged Commodities under Legal Metrology (Packaged Commodities) Rules, 2011 by scanning products, images and labels.'],
    ['Theme', 'Agriculture, FoodTech & Rural Development'],
    ['PS Category', 'Software'],
    ['Team ID', 'College allocation pending'],
    ['Team Name', 'NiyamLens'],
  ]
  let y = 2.34
  rows.forEach((row, index) => {
    slide.addShape(pptx.ShapeType.ellipse, {
      x: 0.66, y: y + 0.11, w: 0.1, h: 0.1,
      fill: { color: C.black }, line: { color: C.black },
    })
    addRichText(slide, [
      { text: `${row[0]} – `, options: { bold: true, color: C.black } },
      { text: row[1], options: { color: C.black } },
    ], 0.88, y, index === 1 ? 6.45 : 5.9, index === 1 ? 0.88 : 0.48, {
      fontSize: index === 1 ? 13.3 : 15.2,
    })
    y += index === 1 ? 1.02 : 0.68
  })
  slide.addNotes('State the exact problem statement and team identity. Introduce NiyamLens as an evidence-grade inspection assistant, not an autonomous enforcement system.')
}

function addSolutionSlide() {
  const slide = pptx.addSlide()
  addSectionChrome(slide, 'NIYAMLENS', 2)
  addSectionLabel(slide, 'Proposed Solution / Approach')

  addPanel(slide, 0.4, 1.37, 4.2, 4.86, { fill: C.white, line: C.line, width: 1 })
  addText(slide, 'From image to defensible evidence', 0.66, 1.58, 3.68, 0.37, {
    fontFace: 'Cambria', fontSize: 19, bold: true, color: C.blueDark,
  })
  addBullet(slide, 'Guided capture', 'Front, back, side and declaration panels; quality checks and original SHA-256.', 0.68, 2.1, 3.55, C.orange, 12.5, 0.75)
  addBullet(slide, 'Hybrid OCR', 'Three-pass local scan, seven-pass deep scan and an explicit connected-OCR option.', 0.68, 2.98, 3.55, C.green, 12.5, 0.75)
  addBullet(slide, 'Rules-as-code', 'Rule 6 declarations, Rule 7 Table-I typography and Rule 26 exemptions.', 0.68, 3.86, 3.55, C.blueDark, 12.5, 0.75)
  addBullet(slide, 'Safe verdict', 'PASS, FLAG, REVIEW or EXEMPT with source regions, uncertainty and officer audit.', 0.68, 4.74, 3.55, C.red, 12.5, 0.75)
  addPanel(slide, 0.66, 5.58, 3.68, 0.42, { fill: C.bluePale, line: C.blueDark, width: 0.8, rounded: true })
  addText(slide, 'OCR proposes evidence. Rules and officers decide.', 0.78, 5.66, 3.44, 0.22, { fontSize: 10.5, bold: true, color: C.blueDark, align: 'center' })

  addPanel(slide, 4.84, 1.37, 8.08, 4.86, { fill: C.white, line: C.line, width: 1 })
  slide.addImage({ path: path.join(ASSETS, 'ocr-verdict-wide.png'), x: 5.02, y: 1.57, w: 7.72, h: 3.78 })
  addText(slide, 'WORKING PROTOTYPE: OCR + STRUCTURED EVIDENCE + RULE VERDICT', 5.0, 5.43, 7.78, 0.26, {
    fontSize: 10.4, bold: true, color: C.blueDark, align: 'center',
  })
  const innovations = [
    ['01', 'Unseen-packet test'],
    ['02', 'Area-tier uncertainty'],
    ['03', 'Rule 26 carve-outs'],
    ['04', 'Auditable abstention'],
  ]
  innovations.forEach((item, index) => {
    const x = 5.06 + index * 1.91
    addPanel(slide, x, 5.76, 1.72, 0.68, { fill: index % 2 ? C.greenPale : C.orangePale, line: index % 2 ? C.green : C.orange, width: 0.8, rounded: true })
    addText(slide, item[0], x + 0.08, 5.84, 0.3, 0.18, { fontSize: 8, bold: true, color: index % 2 ? C.green : C.orange })
    addText(slide, item[1], x + 0.08, 6.04, 1.56, 0.22, { fontSize: 8.8, bold: true, color: C.black, align: 'center' })
  })
  addText(slide, 'Decision support only; Legal Metrology officer verification remains explicit.', 0.5, 6.56, 12.3, 0.25, { fontSize: 10.2, italic: true, color: C.gray, align: 'center' })
  addTeamMark(slide)
  addSihLogo(slide)
  slide.addNotes('Explain why this is not an OCR wrapper. Show the real prototype screen, then walk through guided evidence, hybrid OCR, deterministic rules and calibrated abstention.')
}

function addTechnicalSlide() {
  const slide = pptx.addSlide()
  addSectionChrome(slide, 'TECHNICAL APPROACH', 3)

  const steps = [
    ['01', 'CAPTURE', '4 panels\nquality + hash', C.blueDark],
    ['02', 'RECOGNIZE', 'local / deep /\nconnected OCR', C.green],
    ['03', 'STRUCTURE', 'MRP • quantity •\ndate • entity', C.orange],
    ['04', 'MEASURE', 'homography +\nscale uncertainty', C.blueDark],
    ['05', 'EVALUATE', 'versioned Rule\n6 / 7 / 26', C.red],
    ['06', 'SEAL', 'audit chain +\nevidence report', C.green],
  ]
  steps.forEach((s, index) => {
    const x = 0.27 + index * 2.14
    addStepBox(slide, s[0], s[1], s[2], x, 1.03, 1.82, s[3])
    if (index < steps.length - 1) {
      slide.addShape(pptx.ShapeType.chevron, {
        x: x + 1.86, y: 1.49, w: 0.24, h: 0.39,
        fill: { color: C.green }, line: { color: C.green },
      })
    }
  })

  const zones = [
    {
      x: 0.38, title: 'ZONE 1 — BROWSER PWA', color: C.blueDark, fill: C.bluePale,
      items: ['React 18 + Vite', 'Canvas rectification', 'Tesseract.js bundled OCR', 'Installable offline service worker'],
    },
    {
      x: 4.55, title: 'ZONE 2 — TRUST + RULE LAYER', color: C.green, fill: C.greenPale,
      items: ['SHA-256 evidence integrity', 'IndexedDB local register', 'Deterministic versioned matrix', 'Rule outcome + officer disposition'],
    },
    {
      x: 8.72, title: 'ZONE 3 — OPTIONAL SERVICE', color: C.orange, fill: C.orangePale,
      items: ['Explicit connected-OCR action', 'Vercel serverless function', 'Google Vision key stays server-side', 'Core flow remains complete offline'],
    },
  ]
  zones.forEach((zone) => {
    addPanel(slide, zone.x, 2.72, 3.86, 3.12, { fill: zone.fill, line: zone.color, width: 1 })
    addText(slide, zone.title, zone.x + 0.18, 2.9, 3.5, 0.32, { fontSize: 13.2, bold: true, color: zone.color, align: 'center' })
    zone.items.forEach((item, index) => {
      slide.addShape(pptx.ShapeType.ellipse, {
        x: zone.x + 0.28, y: 3.43 + index * 0.52, w: 0.11, h: 0.11,
        fill: { color: zone.color }, line: { color: zone.color },
      })
      addText(slide, item, zone.x + 0.5, 3.33 + index * 0.52, 3.05, 0.32, { fontSize: 11.6, color: C.black })
    })
  })
  addPanel(slide, 0.38, 6.06, 12.2, 0.66, { fill: C.white, line: C.line, width: 1, rounded: true })
  addText(slide, 'COMPONENTS / TECHNOLOGY STACK', 0.6, 6.18, 2.45, 0.28, { fontSize: 10.7, bold: true, color: C.blueDark, align: 'center' })
  addText(slide, 'React 18   •   Vite   •   Canvas API   •   Tesseract.js   •   Web Crypto   •   IndexedDB   •   Playwright   •   Vercel', 3.18, 6.18, 9.05, 0.28, { fontSize: 11.2, bold: true, color: C.black, align: 'center' })
  // Reapply the official header above the dense architecture diagram.
  addTeamMark(slide)
  addSihLogo(slide)
  addText(slide, 'TECHNICAL APPROACH', 2.0, 0.08, 9.05, 0.64, {
    fontFace: 'Cambria', fontSize: 28, bold: true, color: C.black, align: 'center',
  })
  addFooter(slide, 3)
  slide.addNotes('Present the system as a six-stage evidence pipeline. Keep capture, OCR and legal evaluation separate. Emphasize that cloud OCR is optional and explicit, while the core inspection path remains local-first.')
}

function addFeasibilitySlide() {
  const slide = pptx.addSlide()
  addSectionChrome(slide, 'FEASIBILITY AND VIABILITY', 4)

  const top = [
    { x: 0.22, title: 'Feasibility', color: C.blueDark, items: ['31 implemented capabilities', '54/54 automated tests pass', 'Production build + browser QA pass'] },
    { x: 4.53, title: 'Viability', color: C.green, items: ['PWA + bundled OCR', 'Local IndexedDB evidence', 'No cloud required for core flow'] },
    { x: 8.84, title: 'Practical Implementation', color: C.orange, items: ['Random-packet Blind Challenge', 'Vercel-ready release candidate', 'Field/legal approvals remain visible'] },
  ]
  top.forEach((block) => {
    addPanel(slide, block.x, 0.89, 4.25, 1.56, { fill: C.white, line: C.black, width: 1 })
    addText(slide, block.title, block.x + 0.15, 0.98, 3.95, 0.3, { fontFace: 'Cambria', fontSize: 17, bold: true, color: block.color })
    block.items.forEach((item, index) => addBullet(slide, '', item, block.x + 0.18, 1.34 + index * 0.32, 3.82, block.color, 10.4, 0.28))
  })

  addPanel(slide, 0.22, 2.68, 12.87, 4.06, { fill: C.white, line: C.black, width: 1.2, rounded: true })
  slide.addShape(pptx.ShapeType.line, { x: 6.67, y: 2.84, w: 0, h: 3.68, line: { color: 'BFC5C8', width: 1 } })
  addText(slide, 'POTENTIAL CHALLENGES AND RISKS', 0.62, 2.9, 5.55, 0.32, { fontSize: 14.5, bold: true, color: C.red, align: 'center' })
  addText(slide, 'STRATEGIES FOR OVERCOMING CHALLENGES', 7.01, 2.9, 5.55, 0.32, { fontSize: 14.5, bold: true, color: C.green, align: 'center' })

  const risks = [
    'Small, curved or glared text can reduce OCR recall.',
    'Panel-area or scale error can flip a font-size result.',
    'Exemptions and amendments can change applicability.',
    'Inspection evidence may be offline or sensitive.',
    'Automation could create a false accusation.',
  ]
  const safeguards = [
    'Quality gates, retake guidance, deep tiles and optional connected OCR.',
    'Homography, same-panel calibration and uncertainty → REVIEW.',
    'Versioned rule pack, Rule 26 carve-outs and legal approval register.',
    'Local-first OCR/storage, consent and encrypted evidence transfer.',
    'Missing view ≠ violation; preserve source, supervisor reason and audit.',
  ]
  risks.forEach((risk, index) => {
    const y = 3.37 + index * 0.62
    slide.addShape(pptx.ShapeType.ellipse, { x: 0.55, y: y + 0.02, w: 0.34, h: 0.34, fill: { color: C.red }, line: { color: C.red } })
    addText(slide, String(index + 1).padStart(2, '0'), 0.55, y + 0.09, 0.34, 0.15, { fontSize: 7.5, bold: true, color: C.white, align: 'center' })
    addText(slide, risk, 1.03, y, 5.2, 0.39, { fontSize: 11.5, color: C.black })
    slide.addShape(pptx.ShapeType.ellipse, { x: 6.98, y: y + 0.02, w: 0.34, h: 0.34, fill: { color: C.green }, line: { color: C.green } })
    addText(slide, String(index + 1).padStart(2, '0'), 6.98, y + 0.09, 0.34, 0.15, { fontSize: 7.5, bold: true, color: C.white, align: 'center' })
    addText(slide, safeguards[index], 7.47, y, 5.15, 0.43, { fontSize: 11.3, color: C.black })
    if (index < risks.length - 1) {
      slide.addShape(pptx.ShapeType.line, { x: 0.55, y: y + 0.5, w: 5.7, h: 0, line: { color: 'D7DBDD', width: 0.5 } })
      slide.addShape(pptx.ShapeType.line, { x: 6.98, y: y + 0.5, w: 5.65, h: 0, line: { color: 'D7DBDD', width: 0.5 } })
    }
  })
  addTeamMark(slide)
  addSihLogo(slide)
  addText(slide, 'FEASIBILITY AND VIABILITY', 2.0, 0.08, 9.05, 0.64, {
    fontFace: 'Cambria', fontSize: 28, bold: true, color: C.black, align: 'center',
  })
  addFooter(slide, 4)
  slide.addNotes('Lead with what already works, then show the explicit boundaries. Each major risk has a built safeguard. Do not describe the ten-photo OCR pilot as field accuracy or claim regulatory approval.')
}

function addImpactSlide() {
  const slide = pptx.addSlide()
  addSectionChrome(slide, 'IMPACT AND BENEFITS', 5)

  addPanel(slide, 0.36, 1.02, 6.36, 4.78, { fill: C.white, line: C.line, width: 1 })
  slide.addImage({ path: path.join(ROOT, 'qa-dashboard.png'), x: 0.5, y: 1.17, w: 6.08, h: 4.23 })
  addPanel(slide, 0.68, 5.15, 5.7, 0.45, { fill: C.bluePale, line: C.blueDark, width: 0.8, rounded: true })
  addText(slide, 'One record links image, declaration, geometry, rule and human disposition.', 0.82, 5.25, 5.42, 0.2, { fontSize: 10.2, bold: true, color: C.blueDark, align: 'center' })

  const audience = [
    { x: 7.0, y: 1.02, title: 'INSPECTOR', head: 'Faster triage', body: 'Guided capture, grounded fields and a one-click evidence packet.', color: C.green },
    { x: 10.04, y: 1.02, title: 'SUPERVISOR', head: 'Reviewable decisions', body: 'Reason-required disposition with the automated result preserved.', color: C.blueDark },
    { x: 7.0, y: 3.0, title: 'CONSUMER / BUSINESS', head: 'Explainable findings', body: 'Shows what is missing, uncertain, exempt or outside the current scope.', color: C.orange },
    { x: 10.04, y: 3.0, title: 'DEPARTMENT', head: 'Operational visibility', body: 'Local register, status dashboard and labelled validation workflow.', color: C.red },
  ]
  audience.forEach((card, index) => {
    addPanel(slide, card.x, card.y, 2.73, 1.72, { fill: C.white, line: card.color, width: 1, rounded: true })
    slide.addShape(pptx.ShapeType.ellipse, { x: card.x + 0.16, y: card.y + 0.15, w: 0.38, h: 0.38, fill: { color: card.color }, line: { color: card.color } })
    addText(slide, String(index + 1).padStart(2, '0'), card.x + 0.16, card.y + 0.25, 0.38, 0.14, { fontSize: 7.8, bold: true, color: C.white, align: 'center' })
    addText(slide, card.title, card.x + 0.66, card.y + 0.16, 1.86, 0.25, { fontSize: 9.8, bold: true, color: card.color })
    addText(slide, card.head, card.x + 0.18, card.y + 0.63, 2.35, 0.31, { fontFace: 'Cambria', fontSize: 15.3, bold: true, color: C.black })
    addText(slide, card.body, card.x + 0.18, card.y + 1.01, 2.34, 0.51, { fontSize: 10.2, color: C.gray, valign: 'top' })
  })

  addPanel(slide, 7.0, 5.06, 5.77, 1.2, { fill: C.paleGray, line: C.line, width: 1, rounded: true })
  const benefits = [
    ['Social', 'Fairer, transparent inspection'],
    ['Economic', 'Less repetitive manual collation'],
    ['Operational', 'Auditable evidence at scale'],
    ['Governance', 'Human authority stays explicit'],
  ]
  benefits.forEach((benefit, index) => {
    const col = index % 2
    const row = Math.floor(index / 2)
    const x = 7.24 + col * 2.82
    const y = 5.25 + row * 0.43
    addText(slide, benefit[0], x, y, 0.9, 0.2, { fontSize: 9.7, bold: true, color: index % 2 ? C.blueDark : C.green })
    addText(slide, benefit[1], x + 0.95, y, 1.75, 0.27, { fontSize: 9.2, color: C.black })
  })
  addText(slide, 'From “trust the dashboard” to “inspect the source, rule, measurement and audit trail.”', 0.5, 6.55, 12.25, 0.25, { fontSize: 10.5, italic: true, color: C.gray, align: 'center' })
  addTeamMark(slide)
  addSihLogo(slide)
  slide.addNotes('Connect each user group to a concrete artifact already visible in the prototype. Avoid unmeasured percentage claims. The primary benefit is safer, explainable and auditable triage.')
}

function addReferenceRow(slide, number, title, owner, url, y) {
  slide.addShape(pptx.ShapeType.ellipse, { x: 0.68, y: y + 0.03, w: 0.31, h: 0.31, fill: { color: C.blueDark }, line: { color: C.blueDark } })
  addText(slide, number, 0.68, y + 0.1, 0.31, 0.14, { fontSize: 7.5, bold: true, color: C.white, align: 'center' })
  addRichText(slide, [
    { text: title, options: { bold: true, color: C.blueDark, underline: { color: C.blueDark }, hyperlink: { url } } },
    { text: `  —  ${owner}`, options: { color: C.gray } },
  ], 1.14, y, 6.55, 0.4, { fontSize: 10.5, valign: 'mid' })
}

function addResearchSlide() {
  const slide = pptx.addSlide()
  addSectionChrome(slide, 'RESEARCH AND REFERENCES', 6)

  const metrics = [
    ['54 / 54', 'AUTOMATED TESTS PASS', C.blueDark],
    ['17', 'REAL PHOTOS • 10 PRODUCTS', C.green],
    ['61.1%', 'STANDARD TOKEN RECALL', C.blueDark],
    ['67.5%', 'DEEP-SCAN TOKEN RECALL', C.orange],
    ['93.7%', 'PRECOMPUTED CLOUD BASELINE', C.red],
  ]
  metrics.forEach((m, index) => addMetric(slide, m[0], m[1], 0.42 + index * 2.56, 2.34, m[2]))
  addText(slide, 'Same expected tokens • no manual corrections • reliability and engine confidence are not accuracy', 0.52, 2.0, 12.25, 0.25, { fontSize: 9.8, italic: true, color: C.gray, align: 'center' })

  addPanel(slide, 0.4, 2.38, 7.67, 4.23, { fill: C.white, line: C.black, width: 1, rounded: true })
  addText(slide, 'OFFICIAL / PRIMARY SOURCES', 0.67, 2.59, 4.0, 0.3, { fontFace: 'Cambria', fontSize: 17, bold: true, color: C.blueDark })
  const sources = [
    ['01', 'Legal Metrology (Packaged Commodities) Rules, 2011 + amendments', 'Department of Consumer Affairs', 'https://consumeraffairs.gov.in/public/upload/admin/cmsfiles/whatsnews/Book_on_Legal_Metrology_Packaged_Commodities_Rules%2C2011_with_all_amendments_whatsnews.pdf'],
    ['02', 'Current Legal Metrology Acts & Rules index', 'Department of Consumer Affairs', 'https://consumeraffairs.gov.in/pages/legal-metrology-act'],
    ['03', 'Packaged Commodities FAQ', 'Department of Consumer Affairs', 'https://consumeraffairs.gov.in/public/upload/admin/cmsfiles/whatsnews/FAQs_on_Packaged_Commodities%2C_Rules_2011_whatsnews.pdf'],
    ['04', 'Open product-image data and API', 'Open Food Facts', 'https://openfoodfacts.github.io/openfoodfacts-server/api/'],
    ['05', 'Document text detection and request format', 'Google Cloud Vision', 'https://docs.cloud.google.com/vision/docs/ocr'],
    ['06', 'Prototype, test reports and architecture', 'NiyamLens repository', 'https://github.com/DuvvuruDeepakReddy18/NiyamLens-SIH26034'],
  ]
  sources.forEach((item, index) => addReferenceRow(slide, item[0], item[1], item[2], item[3], 3.02 + index * 0.52))

  addPanel(slide, 8.32, 2.38, 4.58, 4.23, { fill: C.bluePale, line: C.blueDark, width: 1, rounded: true })
  addText(slide, 'BEFORE ENFORCEMENT USE', 8.63, 2.59, 3.98, 0.3, { fontFace: 'Cambria', fontSize: 17, bold: true, color: C.blueDark, align: 'center' })
  const gates = [
    'Freeze a 250+ package, package-level test split with dual review.',
    'Obtain amendment-complete Legal Metrology approval for each rule profile.',
    'Laboratory-validate phone, marker and curved-panel measurement error.',
    'Add departmental SSO, shared storage, retention and audit anchoring.',
  ]
  gates.forEach((gate, index) => {
    const y = 3.18 + index * 0.72
    slide.addShape(pptx.ShapeType.ellipse, { x: 8.63, y, w: 0.38, h: 0.38, fill: { color: C.orange }, line: { color: C.orange } })
    addText(slide, String(index + 1).padStart(2, '0'), 8.63, y + 0.1, 0.38, 0.14, { fontSize: 7.8, bold: true, color: C.white, align: 'center' })
    addText(slide, gate, 9.18, y - 0.02, 3.32, 0.5, { fontSize: 10.7, color: C.black, valign: 'top' })
  })
  addPanel(slide, 8.64, 5.93, 3.94, 0.45, { fill: C.green, line: C.green, width: 1, rounded: true })
  addText(slide, 'WIN CONDITION: survive the judge’s unseen packet—honestly.', 8.78, 6.02, 3.66, 0.22, { fontSize: 9.8, bold: true, color: C.white, align: 'center' })
  addText(slide, 'Pilot measurements show progress; they are not a field-accuracy or enforcement claim.', 0.52, 6.67, 12.25, 0.22, { fontSize: 9.5, italic: true, color: C.gray, align: 'center' })
  addTeamMark(slide)
  addSihLogo(slide)
  addText(slide, 'RESEARCH AND REFERENCES', 2.0, 0.08, 9.05, 0.64, {
    fontFace: 'Cambria', fontSize: 28, bold: true, color: C.black, align: 'center',
  })
  addFooter(slide, 6)
  slide.addNotes('Close with measured evidence and primary sources. Standard local token recall is 61.1%; deep scan is 67.5% on the same 17 declaration-panel photos from ten products. The 93.7% number is a precomputed cloud baseline, not live NiyamLens accuracy.')
}

async function main() {
  await prepareAssets()
  addTitleSlide()
  addSolutionSlide()
  addTechnicalSlide()
  addFeasibilitySlide()
  addImpactSlide()
  addResearchSlide()
  await pptx.writeFile({ fileName: OUTPUT })
  console.log(`Created ${OUTPUT}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

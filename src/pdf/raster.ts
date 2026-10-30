/** A drawing as a PNG, with its size as it was on the page, px. */
export interface Png {
  url: string
  width: number
  height: number
}

/** Styles copied onto each element from the page's CSS, which an SVG drawn as an image doesn't see. */
const PROPS = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'paint-order',
  'opacity',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'text-anchor',
  'dominant-baseline',
  'vector-effect',
]

/** "4px 4px" times k, for a dash pattern given in screen px. */
const scalePx = (v: string, k: number) => v.replace(/[\d.]+/g, (n) => String(parseFloat(n) * k))

/**
 * An SVG on the page as a PNG, `scale` times its size there so it stays sharp in print. A line that keeps
 * its width on screen however the drawing is zoomed (non-scaling-stroke) is widened to match.
 */
export async function svgToPng(svg: SVGSVGElement, scale = 3): Promise<Png> {
  const { width, height } = svg.getBoundingClientRect()
  const copy = svg.cloneNode(true) as SVGSVGElement
  const from = [svg, ...svg.querySelectorAll('*')]
  const to = [copy, ...copy.querySelectorAll('*')]
  from.forEach((el, i) => {
    const cs = getComputedStyle(el)
    const style = (to[i] as SVGElement).style
    for (const p of PROPS) style.setProperty(p, cs.getPropertyValue(p))
    if (cs.getPropertyValue('vector-effect') === 'non-scaling-stroke') {
      style.setProperty('stroke-width', scalePx(cs.getPropertyValue('stroke-width'), scale))
      const dash = cs.getPropertyValue('stroke-dasharray')
      if (dash !== 'none') style.setProperty('stroke-dasharray', scalePx(dash, scale))
    }
  })
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  copy.setAttribute('width', String(width * scale))
  copy.setAttribute('height', String(height * scale))
  const src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }))
  const img = new Image()
  img.src = src
  try {
    await img.decode()
  } finally {
    URL.revokeObjectURL(src)
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  return { url: canvas.toDataURL('image/png'), width, height }
}

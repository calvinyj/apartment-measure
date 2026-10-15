import { describe, expect, it } from 'vitest'
import { formatPrice, furnitureList, furnitureSpots, itemHref, linkSite, sizeLabel, statusTotals } from './furniture'
import type { FurnitureItem, Room } from './types'

const item = (patch: Partial<FurnitureItem>): FurnitureItem => ({
  id: 'f',
  roomId: 'a',
  x: 0,
  y: 0,
  name: 'Sofa',
  model: '',
  url: '',
  width: null,
  depth: null,
  height: null,
  price: null,
  status: 'pending',
  ...patch,
})

describe('sizeLabel', () => {
  it('gives all three as W × D × H in the unit', () => {
    expect(sizeLabel(item({ width: 2040, depth: 990, height: 830 }), 'mm')).toBe('2,040 × 990 × 830 mm')
    expect(sizeLabel(item({ width: 2040, depth: 990, height: 830 }), 'cm')).toBe('204 × 99 × 83 cm')
  })

  it('names the ones set when some are missing', () => {
    expect(sizeLabel(item({ width: 600, height: 1800 }), 'mm')).toBe('W 600 × H 1,800 mm')
    expect(sizeLabel(item({}), 'mm')).toBe('')
  })
})

describe('formatPrice', () => {
  it('shows cents only when there are some', () => {
    expect(formatPrice(1299)).toBe('RM 1,299')
    expect(formatPrice(89.9)).toBe('RM 89.90')
  })
})

describe('itemHref', () => {
  it('adds https:// to an address typed without it', () => {
    expect(itemHref('www.ikea.com/my/en/p/sofa')).toBe('https://www.ikea.com/my/en/p/sofa')
    expect(itemHref(' https://shopee.com.my/x ')).toBe('https://shopee.com.my/x')
    expect(linkSite('https://www.ikea.com/my/en/p/sofa')).toBe('ikea.com')
  })

  it('refuses what isn’t a web address', () => {
    expect(itemHref('')).toBeNull()
    expect(itemHref('javascript:alert(1)')).toBeNull()
    expect(itemHref('sofa from the shop')).toBeNull()
    expect(linkSite('sofa')).toBe('')
  })
})

describe('furnitureList and statusTotals', () => {
  const rooms = [{ id: 'b' }, { id: 'a' }] as Room[]
  const items = [
    item({ id: '1', roomId: 'a', price: 1000 }),
    item({ id: '2', roomId: 'b', status: 'ordered', price: 250.5 }),
    item({ id: '3', roomId: 'a', status: 'ordered' }),
    item({ id: '4', roomId: 'gone' }),
  ]

  it('goes room by room as the rooms are listed, leaving out ones whose room is gone', () => {
    expect(furnitureList(rooms, items).map((x) => x.item.id)).toEqual(['2', '1', '3'])
  })

  it('totals each status, counting the ones with no price', () => {
    expect(statusTotals(items.slice(0, 3))).toEqual([
      { status: 'pending', count: 1, price: 1000, unpriced: 0 },
      { status: 'ordered', count: 2, price: 250.5, unpriced: 1 },
    ])
  })
})

describe('furnitureSpots', () => {
  it('puts items at the same spot together, measured from their room', () => {
    const anchors = new Map([
      ['a', { x: 1000, y: 0 }],
      ['b', { x: 0, y: 0 }],
    ])
    const spots = furnitureSpots(anchors, [
      item({ id: 'tv', x: 10, y: 20 }),
      item({ id: 'sofa', x: 500, y: 20 }),
      item({ id: 'console', x: 10, y: 20 }),
      item({ id: 'other room', roomId: 'b', x: 10, y: 20 }),
      item({ id: 'gone', roomId: 'c' }),
    ])
    expect(spots.map((s) => [s.at, s.items.map((f) => f.id)])).toEqual([
      [{ x: 1010, y: 20 }, ['tv', 'console']],
      [{ x: 1500, y: 20 }, ['sofa']],
      [{ x: 10, y: 20 }, ['other room']],
    ])
  })
})

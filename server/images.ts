import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/**
 * Plan images live as plain files: <dir>/<layoutId>/plan-<version>.<ext>.
 * The database only records which file is current.
 */
export function imageFiles(dir: string) {
  mkdirSync(dir, { recursive: true })
  const folder = (layoutId: string) => join(dir, layoutId)

  return {
    /** Returns the file name relative to the uploads dir. */
    write(layoutId: string, version: number, mime: string, bytes: Uint8Array): string {
      mkdirSync(folder(layoutId), { recursive: true })
      const name = `${layoutId}/plan-${version}.${EXT[mime] ?? 'img'}`
      writeFileSync(join(dir, name), bytes)
      return name
    },
    read(name: string): Uint8Array {
      return readFileSync(join(dir, name))
    },
    copy(name: string, toLayoutId: string): string {
      mkdirSync(folder(toLayoutId), { recursive: true })
      const target = `${toLayoutId}/${name.split('/').pop()}`
      copyFileSync(join(dir, name), join(dir, target))
      return target
    },
    remove(name: string) {
      rmSync(join(dir, name), { force: true })
    },
    removeAll(layoutId: string) {
      rmSync(folder(layoutId), { recursive: true, force: true })
    },
  }
}

export type ImageFiles = ReturnType<typeof imageFiles>

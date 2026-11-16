export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024
export const MAX_IMAGE_TARGET_BYTES = 500 * 1024

export function fileSizeError(file: File, maxBytes = MAX_DOCUMENT_BYTES): string | null {
  if (file.size <= maxBytes) return null
  const mb = (maxBytes / (1024 * 1024)).toFixed(0)
  return `El archivo «${file.name}» supera el máximo de ${mb} MB.`
}

export async function compressImage(file: File, maxBytes = MAX_IMAGE_TARGET_BYTES): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  if (file.size <= maxBytes) return file
  try {
    const bitmap = await createImageBitmap(file)
    const maxDimension = Math.max(bitmap.width, bitmap.height)
    const baseScale = Math.min(1, 1920 / maxDimension)
    for (const scale of [baseScale, baseScale * 0.75, baseScale * 0.5, baseScale * 0.35]) {
      for (const quality of [0.75, 0.6, 0.45, 0.3, 0.2]) {
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(bitmap.width * scale))
        canvas.height = Math.max(1, Math.round(bitmap.height * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) return file
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/jpeg', quality),
        )
        if (blob && blob.size <= maxBytes) {
          const baseName = file.name.replace(/\.[^.]+$/, '')
          return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() })
        }
      }
    }
    return file
  } catch {
    return file
  }
}

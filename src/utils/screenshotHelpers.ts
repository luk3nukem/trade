import type { Screenshot } from '../types';

/**
 * Screenshot-like object with optional blob and data fields
 */
interface ScreenshotLike {
  id: string;
  blob?: Blob | Uint8Array | ArrayBuffer | unknown;
  data?: string | unknown; // May be a Dexie Cloud blob reference object
  caption?: string;
}

/**
 * Check if a value is a Dexie Cloud blob reference object
 */
function isDexieCloudBlobRef(value: unknown): value is { _bt: unknown; ref: string; size: number; ct: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_bt' in value &&
    'ref' in value &&
    'size' in value
  );
}

/**
 * Convert a Blob to a base64 data URL string.
 * This is necessary because Dexie Cloud cannot sync Blob objects.
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to convert blob to base64'));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Chunk size for splitting base64 - small enough that Dexie Cloud won't convert to blob ref
const CHUNK_SIZE = 50000;

/**
 * Split a base64 string into chunks to avoid Dexie Cloud blob detection
 */
function splitBase64(base64: string): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < base64.length; i += CHUNK_SIZE) {
    chunks.push(base64.slice(i, i + CHUNK_SIZE));
  }
  return chunks;
}

/**
 * Join base64 chunks back into a single string
 */
function joinBase64(chunks: string[]): string {
  return chunks.join('');
}

/**
 * Prepare screenshots for Dexie Cloud persistence.
 * Converts Blob objects to base64 and splits into chunks to avoid Dexie Cloud blob detection.
 * Format stored: { mimeType: "image/png", chunks: ["chunk1", "chunk2", ...] }
 * Returns a new array with screenshots ready for persistence.
 */
export async function prepareScreenshotsForSave(screenshots: Screenshot[]): Promise<Screenshot[]> {
  const prepared: Screenshot[] = [];

  for (const screenshot of screenshots) {
    // Skip Dexie Cloud blob references - these are corrupted and can't be recovered
    if (screenshot.data && isDexieCloudBlobRef(screenshot.data)) {
      console.warn('[Screenshot] Skipping Dexie Cloud blob reference (unrecoverable):', screenshot.id);
      continue;
    }

    // If screenshot already has valid data in our chunked format, keep as-is
    if (!screenshot.blob && screenshot.data) {
      const dataObj = screenshot.data as { mimeType?: string; chunks?: string[]; base64?: string };
      if (typeof screenshot.data === 'object' && dataObj.mimeType && dataObj.chunks && Array.isArray(dataObj.chunks)) {
        // Already in our chunked format
        prepared.push(screenshot);
        continue;
      }
      // Handle old format with base64 string (convert to chunks)
      if (typeof screenshot.data === 'object' && dataObj.mimeType && typeof dataObj.base64 === 'string') {
        prepared.push({
          id: screenshot.id,
          data: { mimeType: dataObj.mimeType, chunks: splitBase64(dataObj.base64) } as unknown as string,
          caption: screenshot.caption,
          createdAt: screenshot.createdAt,
        });
        continue;
      }
      // Handle legacy data URL string format
      if (typeof screenshot.data === 'string' && screenshot.data.startsWith('data:')) {
        const match = screenshot.data.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          prepared.push({
            id: screenshot.id,
            data: { mimeType: match[1], chunks: splitBase64(match[2]) } as unknown as string,
            caption: screenshot.caption,
            createdAt: screenshot.createdAt,
          });
          continue;
        }
      }
    }

    // If screenshot has a blob, convert to base64 chunks
    if (screenshot.blob) {
      try {
        let blob: Blob;
        let mimeType = 'image/png'; // default
        // Cast to unknown for type checking - Dexie Cloud may return different types
        const blobData = screenshot.blob as unknown;

        // Handle various blob types
        if (blobData instanceof Blob) {
          blob = blobData;
          mimeType = blob.type || mimeType;
        } else if (blobData instanceof Uint8Array || blobData instanceof ArrayBuffer) {
          blob = new Blob([blobData]);
        } else if (typeof blobData === 'object' && blobData !== null && 'byteLength' in blobData) {
          blob = new Blob([blobData as ArrayBuffer]);
        } else {
          // Unknown type, skip this screenshot
          console.warn('[Screenshot] Unknown blob type, skipping:', screenshot.id);
          continue;
        }

        const dataUrl = await blobToBase64(blob);
        // Extract just the base64 part, split into chunks
        const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          prepared.push({
            id: screenshot.id,
            // Store as chunked object to avoid Dexie Cloud blob detection
            data: { mimeType: match[1], chunks: splitBase64(match[2]) } as unknown as string,
            caption: screenshot.caption,
            createdAt: screenshot.createdAt,
          });
        }
      } catch (error) {
        console.error('[Screenshot] Failed to convert blob to base64:', screenshot.id, error);
      }
    }
  }

  return prepared;
}

/**
 * Safely create a URL for displaying a screenshot.
 * Handles various data formats that may come from Dexie Cloud sync:
 * - Native Blob objects
 * - Uint8Array or ArrayBuffer (from sync)
 * - Base64 data URLs (legacy format)
 * - Our custom format: { mimeType: string, base64: string }
 * - Dexie Cloud blob references (returns null - these need cloud resolution)
 *
 * @returns A URL string (either blob URL or base64 data URL) or null if no valid data
 */
export function createScreenshotUrl(screenshot: ScreenshotLike): string | null {
  const blob = screenshot.blob;

  // Check data field first (for saved screenshots)
  if (screenshot.data) {
    // Our chunked format: { mimeType, chunks: string[] }
    if (typeof screenshot.data === 'object' && !isDexieCloudBlobRef(screenshot.data)) {
      const dataObj = screenshot.data as { mimeType?: string; chunks?: string[]; base64?: string };

      // New chunked format
      if (dataObj.mimeType && dataObj.chunks && Array.isArray(dataObj.chunks)) {
        // Verify all chunks are strings (not converted by Dexie Cloud)
        const allStrings = dataObj.chunks.every(c => typeof c === 'string');
        if (allStrings) {
          const base64 = joinBase64(dataObj.chunks);
          return `data:${dataObj.mimeType};base64,${base64}`;
        } else {
          console.warn('[Screenshot] Chunks contain non-string data (Dexie Cloud converted them):', screenshot.id);
          return null;
        }
      }

      // Old format with base64 string
      if (dataObj.mimeType && typeof dataObj.base64 === 'string') {
        return `data:${dataObj.mimeType};base64,${dataObj.base64}`;
      }
    }

    // Legacy format: base64 data URL string
    if (typeof screenshot.data === 'string' && screenshot.data.startsWith('data:')) {
      return screenshot.data;
    }

    // Dexie Cloud blob reference - can't resolve locally, return null
    if (isDexieCloudBlobRef(screenshot.data)) {
      console.warn('[Screenshot] Dexie Cloud blob reference detected, cannot display:', screenshot.id);
      return null;
    }
  }

  // If no data, check blob field (for in-memory screenshots before save)
  if (!blob) {
    return null;
  }

  // Native Blob or File - use directly (for in-memory display before save)
  if (blob instanceof Blob) {
    return URL.createObjectURL(blob);
  }

  // Uint8Array or ArrayBuffer from Dexie Cloud sync - wrap in Blob
  if (blob instanceof Uint8Array || blob instanceof ArrayBuffer) {
    return URL.createObjectURL(new Blob([blob]));
  }

  // Check if blob is an object with byteLength (another ArrayBuffer-like check)
  if (typeof blob === 'object' && blob !== null && 'byteLength' in blob) {
    try {
      return URL.createObjectURL(new Blob([blob as ArrayBuffer]));
    } catch {
      // Fall through
    }
  }

  return null;
}

/**
 * Check if a screenshot has any renderable data
 */
export function hasRenderableScreenshot(screenshot: ScreenshotLike): boolean {
  return createScreenshotUrl(screenshot) !== null;
}

/**
 * Create screenshot URLs for an array of screenshots.
 * Returns a map of screenshot ID to URL for efficient lookup.
 * Only includes screenshots that have valid renderable data.
 */
export function createScreenshotUrlMap(screenshots: ScreenshotLike[]): Map<string, string> {
  const urlMap = new Map<string, string>();

  for (const screenshot of screenshots) {
    const url = createScreenshotUrl(screenshot);
    if (url) {
      urlMap.set(screenshot.id, url);
    }
  }

  return urlMap;
}

/**
 * Revoke all blob URLs in a map (for cleanup).
 * Only revokes blob: URLs, not base64 data URLs.
 */
export function revokeScreenshotUrls(urlMap: Map<string, string>): void {
  for (const url of urlMap.values()) {
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  }
}

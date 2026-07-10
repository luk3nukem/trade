import type { Screenshot } from '../types';

/**
 * Screenshot-like object with optional blob and data fields
 */
interface ScreenshotLike {
  id: string;
  blob?: Blob | Uint8Array | ArrayBuffer | unknown;
  data?: string;
  caption?: string;
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

/**
 * Prepare screenshots for Dexie Cloud persistence.
 * Converts Blob objects to base64 data URLs since Dexie Cloud cannot sync blobs.
 * Returns a new array with screenshots ready for persistence.
 */
export async function prepareScreenshotsForSave(screenshots: Screenshot[]): Promise<Screenshot[]> {
  const prepared: Screenshot[] = [];

  for (const screenshot of screenshots) {
    // If screenshot already has valid base64 data string and no blob, keep as-is
    if (typeof screenshot.data === 'string' && screenshot.data.startsWith('data:') && !screenshot.blob) {
      prepared.push(screenshot);
      continue;
    }

    // If screenshot has a blob, convert to base64
    if (screenshot.blob) {
      try {
        let blob: Blob;
        // Cast to unknown for type checking - Dexie Cloud may return different types
        const blobData = screenshot.blob as unknown;

        // Handle various blob types
        if (blobData instanceof Blob) {
          blob = blobData;
        } else if (blobData instanceof Uint8Array || blobData instanceof ArrayBuffer) {
          blob = new Blob([blobData]);
        } else if (typeof blobData === 'object' && blobData !== null && 'byteLength' in blobData) {
          blob = new Blob([blobData as ArrayBuffer]);
        } else {
          // Unknown type, skip this screenshot
          console.warn('[Screenshot] Unknown blob type, skipping:', screenshot.id);
          continue;
        }

        const base64Data = await blobToBase64(blob);
        prepared.push({
          id: screenshot.id,
          data: base64Data, // Store as base64 string
          // Don't store blob - it won't sync with Dexie Cloud
          caption: screenshot.caption,
          createdAt: screenshot.createdAt,
        });
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
 *
 * @returns A URL string (either blob URL or base64 data URL) or null if no valid data
 */
export function createScreenshotUrl(screenshot: ScreenshotLike): string | null {
  const blob = screenshot.blob;

  // Base64 data URL - primary storage format for Dexie Cloud compatibility
  if (!blob) {
    if (screenshot.data && typeof screenshot.data === 'string') {
      return screenshot.data;
    }
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
      // Fall through to base64 fallback
    }
  }

  // Base64 data URL fallback
  if (screenshot.data && typeof screenshot.data === 'string') {
    return screenshot.data;
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

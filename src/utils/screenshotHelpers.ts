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

/**
 * Prepare screenshots for Dexie Cloud persistence.
 * Converts Blob objects to base64 and stores WITHOUT the data URL prefix.
 * This prevents Dexie Cloud from detecting it as blob data and converting it to a reference.
 * Format stored: { mimeType: "image/png", base64: "iVBORw0KGgo..." }
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

    // If screenshot already has valid data (either string or our custom format) and no blob, keep as-is
    // Check for our new format: object with mimeType and base64
    if (!screenshot.blob && screenshot.data) {
      if (typeof screenshot.data === 'object' && 'mimeType' in (screenshot.data as object) && 'base64' in (screenshot.data as object)) {
        // Already in our custom format
        prepared.push(screenshot);
        continue;
      }
      if (typeof screenshot.data === 'string' && screenshot.data.startsWith('data:')) {
        // Old format data URL - convert to new format to avoid Dexie Cloud blob detection
        const match = screenshot.data.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          prepared.push({
            id: screenshot.id,
            data: { mimeType: match[1], base64: match[2] } as unknown as string,
            caption: screenshot.caption,
            createdAt: screenshot.createdAt,
          });
          continue;
        }
      }
    }

    // If screenshot has a blob, convert to base64
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
        // Extract just the base64 part, store mimeType separately
        // This avoids Dexie Cloud detecting it as blob data
        const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          prepared.push({
            id: screenshot.id,
            // Store as object to avoid Dexie Cloud blob detection
            data: { mimeType: match[1], base64: match[2] } as unknown as string,
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
    // Our new custom format: { mimeType, base64 }
    if (typeof screenshot.data === 'object' && !isDexieCloudBlobRef(screenshot.data)) {
      const dataObj = screenshot.data as { mimeType?: string; base64?: string };
      if (dataObj.mimeType && dataObj.base64) {
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

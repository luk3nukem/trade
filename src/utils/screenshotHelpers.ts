/**
 * Screenshot helper utilities for handling image display.
 *
 * With Dexie Cloud's blob resolution (blobMode: 'eager'), screenshots are stored
 * as native Blob objects. Dexie Cloud handles offloading to cloud storage during
 * sync and transparently resolves them back to Blobs on read.
 */

/**
 * Screenshot-like object with optional blob and data fields
 */
interface ScreenshotLike {
  id: string;
  blob?: Blob | Uint8Array | ArrayBuffer | unknown;
  data?: string; // Legacy: base64 data URL for backward compatibility
  caption?: string;
}

/**
 * Safely create a URL for displaying a screenshot.
 *
 * Primary path: blob instanceof Blob → URL.createObjectURL
 * Fallback paths for edge cases and legacy data.
 *
 * @returns A URL string (blob URL or data URL) or null if no valid data
 */
export function createScreenshotUrl(screenshot: ScreenshotLike): string | null {
  const blob = screenshot.blob;

  // Primary path: Native Blob (including resolved Dexie Cloud blobs)
  if (blob instanceof Blob) {
    return URL.createObjectURL(blob);
  }

  // Fallback: Uint8Array or ArrayBuffer (may come from some sync scenarios)
  if (blob instanceof Uint8Array || blob instanceof ArrayBuffer) {
    return URL.createObjectURL(new Blob([blob]));
  }

  // Fallback: Object with byteLength (ArrayBuffer-like)
  if (typeof blob === 'object' && blob !== null && 'byteLength' in blob) {
    try {
      return URL.createObjectURL(new Blob([blob as ArrayBuffer]));
    } catch {
      // Fall through to data field check
    }
  }

  // Legacy fallback: base64 data URL in the data field
  if (screenshot.data && typeof screenshot.data === 'string' && screenshot.data.startsWith('data:')) {
    return screenshot.data;
  }

  // No valid data source
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

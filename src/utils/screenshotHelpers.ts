import type { Screenshot } from '../types';

/**
 * Safely create a URL for displaying a screenshot.
 * Handles various data formats that may come from Dexie Cloud sync:
 * - Native Blob objects
 * - Uint8Array or ArrayBuffer (from sync)
 * - Base64 data URLs (legacy format)
 *
 * @returns A URL string (either blob URL or base64 data URL) or null if no valid data
 */
export function createScreenshotUrl(screenshot: Screenshot): string | null {
  const blob = screenshot.blob;

  // Native Blob or File - use directly
  if (blob instanceof Blob) {
    return URL.createObjectURL(blob);
  }

  // Uint8Array or ArrayBuffer from Dexie Cloud sync - wrap in Blob
  if (blob instanceof Uint8Array || blob instanceof ArrayBuffer) {
    return URL.createObjectURL(new Blob([blob]));
  }

  // Check if blob is an object with byteLength (another ArrayBuffer-like check)
  if (blob && typeof blob === 'object' && 'byteLength' in blob) {
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
export function hasRenderableScreenshot(screenshot: Screenshot): boolean {
  return createScreenshotUrl(screenshot) !== null;
}

/**
 * Create screenshot URLs for an array of screenshots.
 * Returns a map of screenshot ID to URL for efficient lookup.
 * Only includes screenshots that have valid renderable data.
 */
export function createScreenshotUrlMap(screenshots: Screenshot[]): Map<string, string> {
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

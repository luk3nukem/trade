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

  // DEBUG: Log what we're working with
  console.log('[Screenshot Debug] createScreenshotUrl input:', {
    id: screenshot.id,
    hasBlob: !!blob,
    blobType: blob?.constructor?.name,
    blobInstanceOfBlob: blob instanceof Blob,
    blobInstanceOfUint8Array: blob instanceof Uint8Array,
    blobInstanceOfArrayBuffer: blob instanceof ArrayBuffer,
    hasData: !!screenshot.data,
    dataLength: screenshot.data?.length || 0,
    blobKeys: blob && typeof blob === 'object' ? Object.keys(blob as object) : [],
  });

  // Skip if no blob data
  if (!blob) {
    // Base64 data URL fallback
    if (screenshot.data && typeof screenshot.data === 'string') {
      console.log('[Screenshot Debug] createScreenshotUrl: using base64 data fallback (no blob)');
      return screenshot.data;
    }
    console.log('[Screenshot Debug] createScreenshotUrl: no blob and no data, returning null');
    return null;
  }

  // Native Blob or File - use directly
  if (blob instanceof Blob) {
    console.log('[Screenshot Debug] createScreenshotUrl: native Blob detected, creating URL');
    return URL.createObjectURL(blob);
  }

  // Uint8Array or ArrayBuffer from Dexie Cloud sync - wrap in Blob
  if (blob instanceof Uint8Array || blob instanceof ArrayBuffer) {
    console.log('[Screenshot Debug] createScreenshotUrl: Uint8Array/ArrayBuffer detected, wrapping in Blob');
    return URL.createObjectURL(new Blob([blob]));
  }

  // Check if blob is an object with byteLength (another ArrayBuffer-like check)
  if (typeof blob === 'object' && blob !== null && 'byteLength' in blob) {
    try {
      console.log('[Screenshot Debug] createScreenshotUrl: object with byteLength detected, trying to wrap');
      return URL.createObjectURL(new Blob([blob as ArrayBuffer]));
    } catch (e) {
      console.log('[Screenshot Debug] createScreenshotUrl: failed to wrap object with byteLength', e);
      // Fall through to base64 fallback
    }
  }

  // Base64 data URL fallback
  if (screenshot.data && typeof screenshot.data === 'string') {
    console.log('[Screenshot Debug] createScreenshotUrl: using base64 data fallback');
    return screenshot.data;
  }

  console.log('[Screenshot Debug] createScreenshotUrl: no valid data source, returning null');
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

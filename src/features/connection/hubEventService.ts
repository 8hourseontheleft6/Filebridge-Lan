/**
 * SSE upload-event parsing.
 *
 * Kept separate from the connection controller so malformed events can be
 * unit tested without an EventSource. Invalid JSON is ignored, exactly like
 * the pre-refactor inline handler.
 */
import type { UploadEventPayload } from './types';

export function parseUploadEvent(data: string): UploadEventPayload | null {
  try {
    return JSON.parse(data) as UploadEventPayload;
  } catch {
    return null;
  }
}

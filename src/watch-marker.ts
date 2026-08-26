export type BuildMarkerMatchHandler = () => void;

/**
 * Detects a marker in arbitrary stream chunks. A marker may be split across
 * chunks, and one chunk may contain more than one marker.
 */
export class StreamMarkerDetector {
  private pending = "";

  public constructor(
    private readonly marker: string,
    private readonly onMatch: BuildMarkerMatchHandler,
  ) {
    if (marker.length === 0) {
      throw new Error("A stream marker must not be empty.");
    }
  }

  public push(chunk: string): void {
    const text = this.pending + chunk;
    let searchFrom = 0;
    let markerIndex = text.indexOf(this.marker, searchFrom);

    while (markerIndex !== -1) {
      this.onMatch();
      searchFrom = markerIndex + this.marker.length;
      markerIndex = text.indexOf(this.marker, searchFrom);
    }

    const remainder = text.slice(searchFrom);
    this.pending = this.longestMarkerPrefixSuffix(remainder);
  }

  public reset(): void {
    this.pending = "";
  }

  private longestMarkerPrefixSuffix(text: string): string {
    const maxLength = Math.min(this.marker.length - 1, text.length);
    for (let length = maxLength; length > 0; length -= 1) {
      if (text.endsWith(this.marker.slice(0, length))) {
        return text.slice(-length);
      }
    }
    return "";
  }
}

export function createBuildMarkerDetector(
  marker: string,
  onMatch: BuildMarkerMatchHandler,
): StreamMarkerDetector {
  return new StreamMarkerDetector(marker, onMatch);
}

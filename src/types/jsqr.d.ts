declare module 'jsqr' {
  export interface Point {
    x: number;
    y: number;
  }

  export interface QRCodeLocation {
    topLeftCorner: Point;
    topRightCorner: Point;
    bottomRightCorner: Point;
    bottomLeftCorner: Point;
  }

  export interface QRCode {
    data: string;
    location: QRCodeLocation;
  }

  export interface QRCodeOptions {
    inversionAttempts?: 'dontInvert' | 'onlyInvert' | 'attemptBoth' | 'invertFirst';
  }

  export default function jsQR(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    options?: QRCodeOptions,
  ): QRCode | null;
}

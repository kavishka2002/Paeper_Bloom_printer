export const PRODUCT: 'BLOOMCONNECT';
export const DAY: number;
export const LIMIT: number;
export const DEVICE: RegExp;
export interface Payload {
  licenseId: string;
  productId: string;
  customerName: string;
  deviceId: string;
  issuedAt: number;
  validFrom: number;
  expiresAt: number;
  version: 1;
  keyId: string;
}
export function bytes(value: string): Uint8Array;
export function base64(data: ArrayBuffer | Uint8Array): string;
export function unbase64(value: string): Uint8Array;
export function encode(payload: Payload): string;
export function parse(code: string): {payload: Payload; signature: Uint8Array; signed: string; token: string};

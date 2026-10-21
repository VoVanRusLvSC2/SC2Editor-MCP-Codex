import {readFileSync} from 'node:fs';

/** One reviewed release pin shared by setup, transport and runtime discovery. */
const pin=JSON.parse(readFileSync(new URL('../../../native-toolkit-release.json',import.meta.url),'utf8'));
if(!/^\d+\.\d+\.\d+(?:-rc\.\d+)?$/.test(pin.version)||!Number.isSafeInteger(pin.nativeProtocol)||pin.nativeProtocol<1||!/^[a-f0-9]{64}$/.test(pin.archiveSha256))
  throw Error('NATIVE_RELEASE_PIN_INVALID');
export const nativeRelease:Readonly<{version:string;nativeProtocol:number;archiveSha256:string}>=Object.freeze(pin);

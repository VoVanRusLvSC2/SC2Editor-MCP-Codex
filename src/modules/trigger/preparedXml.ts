import { XmlParseCache } from "../../core/xmlParseCache.js";
const cache = new XmlParseCache();
export const readTriggerXml = (source: string) => cache.read(source);
export const triggerXmlCacheStats = () => cache.stats();

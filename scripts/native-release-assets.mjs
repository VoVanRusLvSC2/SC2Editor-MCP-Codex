// Strict release locations and exact-entry checksum selection, shared by setup tests.
export function nativeReleaseAssets(pin){
 const repository=pin.repository??'VoVanRusLvSC2/SC2NativeToolkit',prefix=pin.assetPrefix??'SC2NativeToolkit';
 if(!/^\d+\.\d+\.\d+(?:-rc\.\d+)?$/.test(pin.version)||!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(repository)||!/^SC2(?:Editor|Native)Toolkit$/.test(prefix))throw Error('NATIVE_RELEASE_LOCATION_INVALID');
 const name=pin.asset??`${prefix}-v${pin.version}-win-x64.zip`,checksumName=pin.checksumAsset??name+'.sha256';
 const basename=value=>typeof value==='string'&&value.length<=255&&/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value);
 if(!basename(name)||!name.endsWith('.zip')||!basename(checksumName)||checksumName===name)throw Error('NATIVE_RELEASE_ASSET_INVALID');
 const base=`https://github.com/${repository}/releases/download/v${pin.version}/`;
 return {repository,name,checksumName,url:base+name,checksumUrl:base+checksumName,allowBareChecksum:checksumName===name+'.sha256'};
}

export function nativePublishedChecksum(text,asset,allowBare=false){
 const matches=[];
 for(const line of text.split(/\r?\n/).map(s=>s.trim()).filter(s=>s&&!s.startsWith('#'))){
  const match=/^([a-f0-9]{64})(?:\s+\*?(.+))?$/i.exec(line);if(!match)continue;
  if(match[2]===asset||match[2]==='./'+asset||match[2]===undefined&&allowBare)matches.push(match[1].toLowerCase());
 }
 if(matches.length===0)throw Error('NATIVE_CHECKSUM_MISSING');
 if(matches.length!==1)throw Error('NATIVE_CHECKSUM_AMBIGUOUS');
 return matches[0];
}

// New self-contained releases omit BUILD.json. The reviewed archive pin remains
// authoritative; the retained MCP transport separately checks the exact version.
export function nativeBuildMetadata(pin,build){
 const mode=pin.buildMetadata??'BUILD.json';
 if(!['BUILD.json','embedded'].includes(mode))throw Error('NATIVE_BUILD_METADATA_INVALID');
 if(mode==='embedded')return {version:pin.version,nativeProtocol:pin.nativeProtocol,buildMetadata:mode};
 if(!build||build.version!==pin.version||build.nativeProtocol!==pin.nativeProtocol)throw Error('NATIVE_PACKAGE_PROTOCOL_MISMATCH');
 return {...build,buildMetadata:mode};
}

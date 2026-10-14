"""Read-only analysis of New Document evidence; never starts SC2Editor.

Consumes local research inputs, the canonical reverse SQLite, a pseudocode
index and an offline runtime-ghidra PE. Raw game files and recovered bodies
remain outside Git. Emits factual summaries, not executable SC2 defaults.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import sqlite3
import struct
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def parse_native_header(data: bytes) -> dict:
    if len(data) < 52 or data[:4] != b'H2CS' or struct.unpack_from('<I', data, 4)[0] != 8:
        raise ValueError('Only observed H2CS v8 header profile is admitted')
    offset = 48
    dependency_count = struct.unpack_from('<I', data, 44)[0]
    if dependency_count > 512:
        raise ValueError('Dependency count exceeds observed bounded profile')
    dependencies = []
    for _ in range(dependency_count):
        end = data.find(b'\0', offset)
        if end < offset or end-offset > 65535:
            raise ValueError('Invalid dependency CString')
        value = data[offset:end].decode('utf-8')
        if not value.startswith(('bnet:', 'file:')):
            raise ValueError('Invalid dependency reference')
        dependencies.append(value)
        offset = end+1
    count = struct.unpack_from('<I', data, offset)[0]
    offset += 4
    if count > 65536:
        raise ValueError('Localized string count exceeds profile budget')
    keys = []
    def string() -> str:
        nonlocal offset
        size = struct.unpack_from('<H', data, offset)[0]
        offset += 2
        if size == 65535 or offset+size > len(data):
            raise ValueError('Unsupported/truncated localized string')
        value = data[offset:offset+size].decode('utf-8')
        offset += size
        return value
    for _ in range(count):
        key = string()
        if offset+4 > len(data):
            raise ValueError('Truncated locale FourCC')
        locale = data[offset:offset+4][::-1].decode('ascii')
        offset += 4
        value = string()
        keys.append({'key': key, 'locale': locale, 'utf8Bytes': len(value.encode('utf8'))})
    if offset != len(data):
        raise ValueError('Unexplained trailing native header bytes')
    return {'version': 8, 'bytes': len(data), 'sha256': digest(data),
            'prefixBytes': 48, 'flagsWord': struct.unpack_from('<I', data, 8)[0],
            'dependencyCount': dependency_count, 'localizedStrings': count,
            'localeCodes': sorted({x['locale'] for x in keys}), 'exactEnd': True,
            'dependencyEncoding': 'CString specifications',
            'localeEncoding': 'u16 UTF8 key + FourCC + u16 UTF8 value',
            'writerDefaultsProven': False}


def summarize_body(index: sqlite3.Connection, root: Path, address: str) -> dict:
    row = index.execute('SELECT * FROM bodies WHERE ghidra_address=? ORDER BY byte_end-byte_start DESC LIMIT 1', (address,)).fetchone()
    if row is None:
        return {'ghidraAddress': address, 'status': 'NO_INDEXED_BODY'}
    file = root / row['source_file']
    with file.open('rb') as stream:
        stream.seek(row['byte_start'])
        body = stream.read(row['byte_end']-row['byte_start'])
    return {'ghidraAddress': address, 'recoveredRva': hex(row['recovered_rva']),
            'functionIndex': row['function_index'], 'source': row['source_file'],
            'byteStart': row['byte_start'], 'byteEnd': row['byte_end'],
            'sha256': digest(body), 'exportHasNoreturnWarning': bool(row['contains_noreturn_warning'])}


def machine_cfg(pe, cs, start: int, stop: int) -> dict:
    import capstone
    base = pe.OPTIONAL_HEADER.ImageBase
    queue = [start]
    seen, outside = {}, []
    while queue and len(seen) < 4096:
        pos = queue.pop()
        if pos in seen or not start <= pos < stop:
            continue
        ins = next(cs.disasm(pe.get_data(pos, 15), base+pos, count=1), None)
        if ins is None:
            raise ValueError(f'Undecodable CFG position {pos:x}')
        seen[pos] = ins
        if ins.mnemonic in ('ret', 'retf', 'int3', 'ud2'):
            continue
        if ins.group(capstone.CS_GRP_JUMP):
            if ins.operands[0].type == capstone.x86.X86_OP_IMM:
                target = ins.operands[0].imm-base
                if start <= target < stop:
                    queue.append(target)
                else:
                    outside.append(hex(target))
            if ins.mnemonic == 'jmp':
                continue
        queue.append(pos+ins.size)
    calls = [{'at': hex(pos), 'target': hex(ins.operands[0].imm-base)} for pos, ins in sorted(seen.items())
             if ins.mnemonic == 'call' and ins.operands[0].type == capstone.x86.X86_OP_IMM]
    return {'imageRvaStart': hex(start), 'rangeStop': hex(stop), 'reachableInstructions': len(seen),
            'outsideBranches': sorted(set(outside)), 'directCalls': calls,
            'scope': 'Bounded static CFG; indirect receivers and serialization semantics are not inferred'}


def analyze(args) -> dict:
    research = Path(args.research)
    reverse = Path(args.reverse)
    metadata_bytes = (reverse/'database/metadata.json').read_bytes()
    metadata = json.loads(metadata_bytes)
    db = sqlite3.connect('file:'+str((reverse/'database/sc2editor.sqlite').resolve())+'?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    tokens = [dict(row) for row in db.execute("SELECT address,text FROM strings WHERE text LIKE 'EDSTR_NEWDOC_%' OR text IN ('NewDocumentDialog','MapTerrainCheck','MapSizeWidthMenu','MapTexSetMenu','ExtensionMod') ORDER BY address")]
    for token in tokens:
        token['nativeStaticRva'] = hex(token.pop('address')-0x140000000)
    archive = Path(args.archive)
    zip_rows = []
    with zipfile.ZipFile(archive) as zip_input:
        prefix = 'SC2Editor_reverse_LATEST_sanitized_2026-09-13/'
        raw_dmp = [info.filename for info in zip_input.infolist() if info.filename.lower().endswith('.dmp')]
        for name in ['database/metadata.json', 'database/strings.json', 'database/active_documents.json',
                     'database/active_stack_objects.json', 'database/editor_app_object_graph.json',
                     'database/global_objects.json', 'database/threads.json', 'reports/ADDRESS_DOMAINS.md']:
            raw = zip_input.read(prefix+name)
            zip_rows.append({'entry': name, 'sha256': digest(raw), 'bytes': len(raw),
                             'sameAsLocal': raw == (reverse/name).read_bytes()})
        zip_count = len(zip_input.infolist())
    index_root = Path(args.pseudocode_root)
    index = sqlite3.connect('file:'+str(Path(args.pseudocode_index).resolve())+'?mode=ro', uri=True)
    index.row_factory = sqlite3.Row
    addresses = ['7ff7418e5fc0', '7ff7418e6880', '7ff7418e6e60', '7ff741b4ff80',
                 '7ff741510f70', '7ff741510c40', '7ff741b4de70']
    bodies = [summarize_body(index, index_root, address) for address in addresses]
    resources = json.loads((research/'resource-provenance.json').read_text('utf8'))
    layout = ET.fromstring((research/'editorlayout.xml').read_bytes())
    dialog = next(n for n in layout.iter('window') if n.attrib.get('label') == 'NewDocumentDialog')
    labels = [n.attrib['label'] for n in dialog if 'label' in n.attrib]
    doc = ET.fromstring((research/'Mutator-DocumentInfo.xml').read_bytes())
    native_flags = [n.text for n in doc.findall('./Flags/Value')]
    headers = []
    for name, filename in [('supplied-map', Path(args.map_components)/'DocumentHeader'),
                           ('native-extension-mod', research/'Mutator-documentheader'),
                           ('native-mod', research/'Frontiers-documentheader')]:
        headers.append({'sourceKind': name, **parse_native_header(filename.read_bytes())})
    import pefile, capstone
    pe_bytes = Path(args.offline_image).read_bytes()
    pe = pefile.PE(data=pe_bytes, fast_load=True)
    cs = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    cs.detail = True
    cfgs = [machine_cfg(pe, cs, start, stop) for start, stop in [(0x785fc0,0x786225),
            (0x3b0f70,0x3b1020), (0x3b0c40,0x3b0f59), (0x9ede70,0x9ee0f0)]]
    height = struct.unpack('<f', pe.get_data(0x3530e3c,4))[0]
    if height != 8.0:
        raise ValueError('Offline initial-height constant does not match the reviewed profile')
    dump_findings = []
    for name in ['active_stack_objects.json','editor_app_object_graph.json','global_objects.json','threads.json']:
        raw = (reverse/'database'/name).read_text('utf8')
        dump_findings.append({'export': name, 'containsNamedNewDocumentEvidence': 'NewDocumentDialog' in raw or 'NewDoc' in raw})
    db.close(); index.close()
    return {'format':'sc2-document-foundation-research-v1', 'date':'2026-10-11',
            'scope':'Empty map/mod foundations only; no landscape or gameplay-script authoring',
            'runtimeImplementationAdded':False, 'editorLaunched':False,
            'reverseSource': {'schemaVersion':metadata['schema_version'],'metadataSha256':digest(metadata_bytes),
                'editorVersion':'5.0.16.97563','recordedExeSha256':metadata['inputs']['exe']['sha256'],
                'recordedDumpSha256':metadata['inputs']['dmp']['sha256'], 'rawDumpRead':False},
            'suppliedZip':{'entries':zip_count,'rawDumpEntries':raw_dmp,'checkedEntries':zip_rows},
            'creationTokens':tokens,'wizardLayout':{'resourceBuild':'5.0.17.98310','controls':labels},
            'gameResourceProvenance':resources,'extensionMod':{'observedXmlFlags':native_flags,
                'extensionToken':'Flags/Value=ExtensionMod','doNotCopyOtherFlags':True,
                'headerFlagsAreNotExtensionBit':all(h['flagsWord']==headers[0]['flagsWord'] for h in headers)},
            'observedNativeHeaderProfile':headers,'pseudocodeBodies':bodies,
            'offlineMachine':{'sha256':digest(pe_bytes),'imageBase':hex(pe.OPTIONAL_HEADER.ImageBase),
                'addressDomain':'matching runtime-ghidra image RVAs; no arbitrary DMP/code-bias projection',
                'cfgs':cfgs,'baseHeightConstant':{'rva':'0x3530e3c','float32':height},
                'widthHeightRead':'selectedIndex*8 + 32 at 0x9edea2/0x9edebc',
                'extensionRequest':'selected type ordinal 4 sets request bit1 at 0x78608e..0x786097; mod factory converts to argument 0x8 at 0x3b0fcc..0x3b0fe7',
                'remainingSemanticGaps':['Fresh native serializers/defaults','Full type/preset initialization','Indirect component receivers']},
            'dumpDerivedFindings':dump_findings,'creationDocumentStateCaptured':False,
            'acceptance':{'syntacticEvidence':'CHECKED','independentCurrentGameResources':'CHECKED',
                'freshDocumentSerialization':'NOT_IMPLEMENTED','editorSaveReopen':'NOT_EXECUTED','gameRuntime':'NOT_EXECUTED'}}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reverse',required=True)
    parser.add_argument('--archive',required=True)
    parser.add_argument('--pseudocode-root',required=True)
    parser.add_argument('--pseudocode-index',required=True)
    parser.add_argument('--offline-image',required=True)
    parser.add_argument('--map-components',required=True)
    parser.add_argument('--research',default='work/document-foundation-research')
    parser.add_argument('--output',default='generated/document-foundation-evidence.json')
    args=parser.parse_args()
    report=analyze(args)
    Path(args.output).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps({'output':args.output,'wizardControls':len(report['wizardLayout']['controls']),
                     'nativeHeaders':len(report['observedNativeHeaderProfile']),
                     'rawDumpInZip':bool(report['suppliedZip']['rawDumpEntries']),
                     'sourceBodies':len(report['pseudocodeBodies']),'runtimeModuleAdded':False}))


if __name__=='__main__':
    main()

/** Reused from the user's AST project; canonical single-element adapter only.
 * Source hashes in generated/trigger-ast-reuse.json. Existing documents are
 * patched by spans, never reserialized wholesale. Unproven FlagInline removed.
 */
import {functionFlags} from './function-flags.js';
import type {ElementJson} from './types.js';
const FLAG_TAGS:Record<string,string> = Object.freeze({
  Native: 'FlagNative',
  Action: 'FlagAction',
  Call: 'FlagCall',
  Event: 'FlagEvent',
  Template: 'Template',
  CustomScript: 'FlagCustomScript',
  Operator: 'FlagOperator',
  CustomAI: 'FlagCustomAI',
  SubFunctions: 'FlagSubFunctions',
  AllowBreak: 'FlagAllowBreak',
  Hidden: 'FlagHidden',
  NoScriptPrefix: 'FlagNoScriptPrefix',
  Deprecated: 'Deprecated',
  Internal: 'Internal',
  Restricted: 'FlagRestricted',
  CreateThread: 'FlagCreateThread',
  Condition: 'FlagCondition',
  NotYetImplemented: 'NotYetImplemented',
})

const text = (value:unknown) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')

const attribute = (value:unknown) => text(value).replaceAll('"', '&quot;').replaceAll("'", '&apos;')

// A map document owns its elements without naming a library: references into
// the document itself carry no Library attribute, and the enclosing library is
// implicit. `serializeTriggerLibrary` sets this to the owning id for the length
// of one synchronous serialization so that every reference tag, at whatever
// depth, drops the attribute the editor would not have written. A reference
// from a named library into the map root must retain an explicit Library="".
let implicitLibraryScope:string|undefined

function refAttributes(ref:any, fallbackLibrary:string) {
  const implicitLibrary = implicitLibraryScope
  if (ref === undefined || ref === null || typeof ref !== 'object') return undefined
  const id = String(ref.id ?? '')
  if (id.length === 0) return undefined
  const typeName = String(ref.type ?? '')
  const named = String(ref.library ?? fallbackLibrary ?? '')
  const library = implicitLibrary !== undefined && named === implicitLibrary ? '' : named
  return [
    ...(typeName ? [`Type="${attribute(typeName)}"`] : []),
    ...(library ? [`Library="${attribute(library)}"`] : named===''&&(implicitLibrary??fallbackLibrary)!==''?['Library=""']:[]),
    `Id="${attribute(id)}"`,
  ].join(' ')
}

// A <SubFunctionType> reference always names a SubFuncType element; the editor
// writes the attribute on every one of them, and a reference without it does
// not resolve, which orphans the calls that belong to that sub-function slot.
const IMPLIED_REF_TYPES:Record<string,string> = { SubFunctionType: 'SubFuncType' }

function refTag(name:string, ref:any, fallbackLibrary:string, indent = '      ') {
  const implied = IMPLIED_REF_TYPES[name]
  const attributes = refAttributes(
    implied !== undefined && ref !== null && typeof ref === 'object' && ref.type === undefined
      ? { ...ref, type: implied }
      : ref,
    fallbackLibrary,
  )
  return attributes === undefined ? [] : [`${indent}<${name} ${attributes}/>`]
}

function parameterTypeTag(name:string, value:any, fallbackLibrary:string, indent = '      ') {
  if (value === undefined || value === null || typeof value !== 'object') return []
  const children:string[] = []
  if (value.type !== undefined) {
    children.push(`${indent}  <Type Value="${attribute(value.type)}"/>`)
  }
  if (value.gameType !== undefined) {
    children.push(`${indent}  <GameType Value="${attribute(value.gameType)}"/>`)
  }
  if (value.variableType !== undefined) children.push(`${indent}  <VariableType Value="${attribute(value.variableType)}"/>`)
  children.push(...refTag('TypeElement', value.typeElement, fallbackLibrary, `${indent}  `))
  return children.length === 0 ? [] : [`${indent}<${name}>`, ...children, `${indent}</${name}>`]
}

// SC2 Editor reads ScriptCode only in the block layout it writes: a line break
// after <ScriptCode>, every code line indented four spaces past the tag, and
// </ScriptCode> on its own line (all 52,909 code lines of the 3,712 blocks in 418
// editor-authored Triggers files). Code on the tag line loads as empty: a Custom
// Script action compiles to nothing and loses its code on save, an Operator
// definition compiles to its bare argument list `(a b c)`. `scriptCodeFromBlock`
// in sax-reader.ts reads the layout back.
function scriptCodeTag(value:unknown, indent = '      ') {
  if (typeof value !== 'string' || value.length === 0) return []
  return [`${indent}<ScriptCode>`, ...value.split(/\r?\n/u).map(line => `${indent}    ${text(line)}`), `${indent}</ScriptCode>`]
}

function commonElementLines(element:any, libraryId:string) {
  const lines:string[] = []
  const identifier = element.identifier ?? (element.displayName === undefined ? element.name : undefined)
  if (identifier !== undefined && String(identifier).length > 0) {
    lines.push(`      <Identifier>${text(identifier)}</Identifier>`)
  }
  if (element.disabled === true) lines.push('      <Disabled/>')
  if (element.initOff === true) lines.push('      <InitOff/>')
  if (element.grammar !== undefined && element.grammarSource !== 'strings') lines.push(`      <Grammar>${text(element.grammar)}</Grammar>`)
  for (const flag of element.type === 'FunctionDef' ? functionFlags(element) : element.flags ?? []) {
    const tag = FLAG_TAGS[flag]
    if (tag !== undefined) lines.push(`      <${tag}/>`)
  }
  if (element.type === 'FunctionDef' && element.section !== undefined) {
    lines.push(element.section.length === 0
      ? '      <Section/>'
      : `      <Section Value="${attribute(element.section)}"/>`)
  }

  switch (element.type) {
    case 'Comment':
      if (element.comment !== undefined) lines.push(`      <Comment>${text(element.comment)}</Comment>`)
      lines.push(...refTag('SubFunctionType', element.subFunctionType, libraryId))
      break
    case 'CustomScript':
      lines.push(...scriptCodeTag(element.scriptCode))
      if (element.initFunc !== undefined) lines.push(`      <InitFunc>${text(element.initFunc)}</InitFunc>`)
      break
    case 'SubFuncType':
      if (element.isAction) lines.push('      <Action/>')
      if (element.isEvent) lines.push('      <Event/>')
      lines.push(...refTag('FunctionDef', element.functionDef, libraryId))
      break
    case 'FunctionDef': {
      lines.push(...parameterTypeTag('ReturnType', element.returnType, libraryId))
      for (const ref of element.parameters ?? []) {
        lines.push(...refTag('Parameter', ref, libraryId))
      }
      for (const ref of element.subFunctionTypes ?? []) {
        lines.push(...refTag('SubFunctionType', ref, libraryId))
      }
      for (const ref of element.localVariables ?? []) {
        lines.push(...refTag('Variable', ref, libraryId))
      }
      // A function body is a list of <FunctionCall>; only a Trigger holds
      // <Action>. The editor does not read <Action> here, so every call in the
      // body reaches it unreferenced and is discarded as an orphan.
      for (const ref of element.actions ?? []) lines.push(...refTag('FunctionCall', ref, libraryId))
      lines.push(...scriptCodeTag(element.scriptCode))
      break
    }
    case 'FunctionCall': {
      lines.push(...refTag('FunctionDef', element.functionDef, libraryId))
      for (const ref of element.parameters ?? []) lines.push(...refTag('Parameter', ref, libraryId))
      for (const ref of element.subFunctions ?? []) {
        lines.push(...refTag('FunctionCall', ref, libraryId))
      }
      lines.push(...refTag('SubFunctionType', element.subFunctionType, libraryId))
      lines.push(...scriptCodeTag(element.scriptCode))
      break
    }
    case 'Param': {
      if (element.valueId !== undefined) lines.push(`      <ValueId Id="${attribute(element.valueId)}"/>`)
      if (element.valueTypeInfo !== undefined) lines.push(`      <ValueTypeInfo Value="${attribute(element.valueTypeInfo)}"/>`)
      if (element.customType !== undefined) lines.push(`      <CustomType Type="${attribute(element.customType)}"/>`)
      lines.push(...scriptCodeTag(element.scriptCode))
      lines.push(...refTag('ParameterDef', element.parameterDef, libraryId))
      if (element.expressionType !== undefined) lines.push(`      <ExpressionType Type="${attribute(element.expressionType)}"/>`)
      if (element.expressionText !== undefined) lines.push(`      <ExpressionText>${text(element.expressionText)}</ExpressionText>`)
      for (const ref of element.expressionParams ?? []) lines.push(...refTag('ExpressionParam', ref, libraryId))
      for (const ref of element.valueParams ?? []) lines.push(...refTag('ValueParam', ref, libraryId))
      if (element.valueType?.type !== undefined) {
        lines.push(`      <ValueType Type="${attribute(element.valueType.type)}"/>`)
      }
      if (element.valueType?.gameType !== undefined) {
        lines.push(`      <ValueGameType Type="${attribute(element.valueType.gameType)}"/>`)
      }
      if (element.value !== undefined) lines.push(`      <Value>${text(element.value)}</Value>`)
      lines.push(...refTag('FunctionCall', element.functionCall, libraryId))
      lines.push(...refTag('Preset', element.preset, libraryId))
      lines.push(...refTag('ValueElement', element.valueElement, libraryId))
      for (const ref of element.valuePresets ?? []) lines.push(...refTag('ValuePreset', ref, libraryId))
      lines.push(...refTag('StructMember', element.structMember, libraryId))
      lines.push(...refTag('Variable', element.variable, libraryId))
      if (Array.isArray(element.array)) {
        for (const ref of element.array) lines.push(...refTag('Array', ref, libraryId))
      } else {
        lines.push(...refTag('Array', element.array, libraryId))
      }
      lines.push(...refTag('Parameter', element.paramRef, libraryId))
      if (element.expressionCode !== undefined) lines.push(`      <ExpressionCode Value="${attribute(element.expressionCode)}"/>`)
      break
    }
    case 'ParamDef':
      lines.push(...parameterTypeTag('ParameterType', element.paramType, libraryId))
      // A preset selector is distinct from ParameterType's typeElement.
      lines.push(...refTag('Preset', element.preset, libraryId))
      lines.push(...refTag('Default', element.default, libraryId))
      if (element.isReference === true) lines.push('      <ParamFlagReference/>')
      if (element.isMultiple === true) lines.push('      <ParamFlagMultiple/>')
      if (element.isPreload === true) lines.push('      <ParamFlagPreload/>')
      if (element.isVariableOnly === true) lines.push('      <ParamFlagVariableOnly/>')
      if (element.isMatchConst === true) lines.push('      <ParamFlagMatchConst/>')
      if (element.isAltDisplay === true) lines.push('      <ParamFlagAltDisplay/>')
      break
    case 'Preset':
      if (element.integer) lines.push('      <PresetInteger/>')
      if (element.asBits) lines.push('      <PresetAsBits/>')
      if (element.generateIdentifier) lines.push('      <PresetGenIdentFunc/>')
      if (element.generateConstants) lines.push('      <PresetGenConstVar/>')
      if (element.baseType !== undefined) {
        lines.push(`      <BaseType Value="${attribute(element.baseType)}"/>`)
      }
      lines.push(...refTag('PresetExtends', element.extends, libraryId))
      for (const ref of element.values ?? []) lines.push(...refTag('Item', ref, libraryId))
      break
    case 'PresetValue':
      if (element.definesDefault === true) lines.push('      <DefinesDefault/>')
      if (element.value !== undefined) lines.push(`      <Value>${text(element.value)}</Value>`)
      break
    case 'Variable': {
      const variableType = parameterTypeTag('VariableType', element.variableType, libraryId)
      if (variableType.length > 0 && ((element.arraySizes?.length ?? 0) > 0 || element.isConstant === true)) {
        const variableTypeChildren = [
          ...(element.arraySizes ?? []).map((size:any) => {
            const ref = refAttributes(size.variable, libraryId)
            const attributes = [
              `Dim="${attribute(size.dim ?? 0)}"`,
              ...(size.value === undefined ? [] : [`Value="${attribute(size.value)}"`]),
              ...(ref === undefined ? [] : [ref]),
            ].join(' ')
            return `        <ArraySize ${attributes}/>`
          }),
          // This is the editor's VariableType contract.  A historical
          // top-level <Const/> is accepted by our tolerant reader, but the SC2
          // editor ignores it and subsequently reports every use in an array
          // bound as non-constant.
          ...(element.isConstant === true ? ['        <Constant/>'] : []),
        ]
        variableType.splice(
          variableType.length - 1,
          0,
          ...variableTypeChildren,
        )
      }
      lines.push(...variableType)
      // The editor writes a variable's initial value as <Value Type="Param"/>;
      // <InitialValue> appears in no document it produces, and a variable
      // carrying one loses its initial value on load.
      lines.push(...refTag('Value', element.initialValue, libraryId))
      if (element.isArray === true && (element.arraySizes?.length ?? 0) === 0) {
        lines.push('      <Array/>')
      }
      break
    }
    case 'Trigger':
      for (const ref of element.events ?? []) lines.push(...refTag('Event', ref, libraryId))
      for (const ref of element.conditions ?? []) lines.push(...refTag('Condition', ref, libraryId))
      for (const ref of element.actions ?? []) lines.push(...refTag('Action', ref, libraryId))
      for (const ref of element.localVariables ?? []) {
        lines.push(...refTag('Variable', ref, libraryId))
      }
      break
    case 'Structure':
      for (const ref of element.variables ?? []) lines.push(...refTag('Variable', ref, libraryId))
      break
    case 'Category':
      for (const ref of element.items ?? []) lines.push(...refTag('Item', ref, libraryId))
      break
  }
  for (const extra of element.unknownXml ?? []) {
    if (extra === null || typeof extra !== 'object' || typeof extra.tag !== 'string' || extra.tag.length === 0) continue
    const attrs = Object.entries(extra.attributes ?? {}).map(([name, value]) => `${name}="${attribute(value)}"`).join(' ')
    const open = attrs.length === 0 ? `      <${extra.tag}` : `      <${extra.tag} ${attrs}`
    if (extra.text === undefined) lines.push(`${open}/>`)
    else lines.push(`${open}>${text(extra.text)}</${extra.tag}>`)
  }
  return lines
}


export function serializeAstElement(element:ElementJson,library=''){
 implicitLibraryScope=library;
 try{return `<Element Type="${attribute(element.type)}" Id="${attribute(element.id)}">\n`+commonElementLines(element,library).join('\n')+'\n</Element>';}finally{implicitLibraryScope=undefined;}
}

# SC2Editor Data Editor static discovery

Source: supplied `SC2Editor_x64.exe` version `5.0.16.97563`, SHA-256 `9cab25db2b7dcfaaad207978b4eac07ec694f1f7cdbee4257d0db0845e14a164`. The executable is read only.

Run:

```bash
npm run data:discover -- /path/to/SC2Editor_x64.exe
```

Output: `generated/data-editor-schema.json`.

## Recovered exact evidence

| Evidence group | Count | Meaning |
| --- | ---: | --- |
| Catalog-class candidates | 1,062 | exact `C*` tokens whose prefixes map to native catalog domains |
| Qualified owner/field descriptors | 661 | exact tokens such as `CUnit_LifeMax` and nested `CUnit_CardLayouts_LayoutButtons_AbilCmd` |
| Catalog link types | 128 | exact tokens such as `CUnitLink`, used as target-domain evidence |
| Generic field/Link types | 5 | `CCatalogGameLink`, `CCatalogReference`, `TCatalogFieldIndex`, `TCatalogFieldPath`, `TCatalogFieldValue` |
| Catalog runtime API tokens | 25 | entry/field/reference count/get/set/modify/type/default/parent operations |
| Object Editor settings | 89 | view/filter/type-name/structure/diff/editor preferences |
| Catalog localization keys | 619 | exact `EDSTR_*` catalog/field/type/value identifiers |
| relevant MSVC RTTI names | 13 | internal `CGameDataLinkField` template specializations |

Every evidence record retains PE file offset, RVA, pointer RVAs, RIP-relative xrefs and containing function ranges where recoverable. This is useful for targeted function-level decompilation without claiming that an arbitrary string is an XML field.

The qualified descriptors make `data.describe_type({ctype:"CUnit"})` useful even before a large dependency corpus is mounted. Examples recovered for `CUnit` include `AbilArray`, `BehaviorArray`, `BuildTime`, `CardLayouts.LayoutButtons.AbilCmd`, `Food`, `LifeMax`, `StockCharge.CountMax` and `TechAliasArray`.

## Critical boundary

The PE debug record references `D:\work\branches\SC2.5.0.a\Code\Bin\Support64\SC2Editor_x64.pdb`, but that private PDB is not present. Therefore class tokens, descriptors and xrefs are exact; complete C++ layouts, vtables, native enum ordinals, ownership of every unqualified string and every validator branch are not recoverable from the supplied artifact alone.

For that reason:

- an exact class token is `EXE_TOKEN_CANDIDATE`, not automatically a serializable catalog object;
- an owner/field descriptor is `EXE_INTERNAL_DESCRIPTOR_PATH_NOT_XML_PROVEN` until matched with real XML or Editor output;
- observed XML remains the authority for spelling/case/carrier;
- unknown values remain `UNKNOWN_NEEDS_RESEARCH` and are preserved losslessly.

This avoids the most damaging failure mode: manufacturing a plausible Data Editor field that the Editor never serializes.


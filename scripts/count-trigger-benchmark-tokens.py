from pathlib import Path
import sys,json,importlib.metadata,os
sys.path.insert(0,str(Path('work/trigger-ast-completion/tokenizer').resolve()))
import tiktoken
os.environ.setdefault('TIKTOKEN_CACHE_DIR',str(Path('work/trigger-ast-completion/tokenizer-cache').resolve()))
folder=Path(sys.argv[1] if len(sys.argv)>1 else 'work/trigger-ast-completion/benchmark')
enc=tiktoken.get_encoding('o200k_base');report=json.loads((folder/'timing-report.json').read_text(encoding='utf-8'))
for case in report['cases']:
 case['tokens']={name:len(enc.encode(Path(file).read_text(encoding='utf-8'),disallowed_special=())) for name,file in case['inputFiles'].items()}
 case['authoringOverheadRatio']=round(case['tokens']['builder']/case['tokens']['galaxy'],3)
report['tokenization']={'library':'tiktoken','version':importlib.metadata.version('tiktoken'),'encoding':'o200k_base','scope':'Artifact text tokens; not actual model billing, hidden reasoning or total interaction usage','commonBuilderImplementationTokens':len(enc.encode(Path('src/modules/trigger/builder.ts').read_text(encoding='utf-8')))}
(folder/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps([{'name':c['name'],'ms':c['warmMedianMs'],'tokens':c['tokens']} for c in report['cases']]))

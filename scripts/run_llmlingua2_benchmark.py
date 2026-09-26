#!/usr/bin/env python3
"""Isolated LLMLingua-2 benchmark runner. Not used by Area-52 runtime."""
import argparse,json,time,sys

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--input",required=True)
    ap.add_argument("--output",required=True)
    args=ap.parse_args()
    with open(args.input,"r",encoding="utf-8") as fh: req=json.load(fh)
    try:
        from llmlingua import PromptCompressor
    except Exception as exc:
        print("LLMLingua is unavailable. Install the external benchmark dependency with: pip install llmlingua",file=sys.stderr)
        print(str(exc),file=sys.stderr)
        return 3
    model=req.get("model","microsoft/llmlingua-2-xlm-roberta-large-meetingbank")
    rate=float(req.get("targetRate",0.5))
    compressor=PromptCompressor(model_name=model,use_llmlingua2=True)
    started=time.perf_counter()
    result=compressor.compress_prompt(req["inputText"],rate=rate)
    elapsed=(time.perf_counter()-started)*1000.0
    text=result.get("compressed_prompt") if isinstance(result,dict) else str(result)
    if text is None: text=""
    in_bytes=len(req["inputText"].encode("utf-8"));out_bytes=len(text.encode("utf-8"))
    nm="NOT_MEASURED"
    out={"kind":"ExternalCompressorBenchmarkResult","schemaVersion":"1","requestId":req["requestId"],"compressorId":"LLMLINGUA2","measurementState":"MEASURED","inputBytes":in_bytes,"outputBytes":out_bytes,"compressionRatio":(out_bytes/in_bytes if in_bytes else 1.0),"factualRetention":None,"temporalRetention":None,"unresolvedThreadRetention":None,"contradictionRetention":None,"relationshipRetention":None,"provenanceRetention":None,"latencyMs":elapsed,"runtimeDependency":"PYTHON+LLMLINGUA2_MODEL","portability":"EXTERNAL_BENCHMARK_ONLY","evidenceRef":None,"compressedText":text,"metricStates":{"inputBytes":"MEASURED","outputBytes":"MEASURED","compressionRatio":"MEASURED","latencyMs":"MEASURED","factualRetention":nm,"temporalRetention":nm,"unresolvedThreadRetention":nm,"contradictionRetention":nm,"relationshipRetention":nm,"provenanceRetention":nm}}
    with open(args.output,"w",encoding="utf-8") as fh: json.dump(out,fh,ensure_ascii=False,indent=2)
    return 0
if __name__=="__main__": raise SystemExit(main())

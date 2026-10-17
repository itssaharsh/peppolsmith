"""Official-rules validator that runs inside the CreateOS VM (python in /opt/v with saxonche).

Only the orchestrator calls this file; the agent's map.py never does.

  validate.py compile           compile the OpenPeppol Schematron to XSLT with the ISO skeleton
  validate.py check <file.xml>  run CEN EN16931 + OpenPeppol BIS 3.0 rules, print JSON
  validate.py selftest          official examples must pass; a changed amount due must fail BR-CO-16
"""
import json
import re
import sys
import time
import xml.etree.ElementTree as ET

from saxonche import PySaxonProcessor

VAL = "/opt/val"
SVRL = "{http://purl.oclc.org/dsdl/svrl}"
RULESETS = [
    ("CEN EN16931 (UBL)", "validation-1.3.17", "EN16931-UBL-validation.xslt"),
    ("Peppol BIS Billing 3.0", "v3.0.20", "PEPPOL-EN16931-UBL.xslt"),
]


def compile_peppol(proc):
    xp = proc.new_xslt30_processor()
    steps = [
        ("iso_dsdl_include.xsl", f"{VAL}/PEPPOL-EN16931-UBL.sch", "/tmp/peppol-1.sch"),
        ("iso_abstract_expand.xsl", "/tmp/peppol-1.sch", "/tmp/peppol-2.sch"),
        ("iso_svrl_for_xslt2.xsl", "/tmp/peppol-2.sch", f"{VAL}/PEPPOL-EN16931-UBL.xslt"),
    ]
    for stylesheet, src, dst in steps:
        xp.compile_stylesheet(stylesheet_file=f"{VAL}/{stylesheet}").transform_to_file(
            source_file=src, output_file=dst
        )


def failures(svrl_text, ruleset):
    root = ET.fromstring(svrl_text)
    out = []
    for fa in root.iter(SVRL + "failed-assert"):
        text = " ".join((fa.findtext(SVRL + "text") or "").split())
        out.append(
            {
                "id": fa.get("id") or "",
                "set": ruleset,
                "flag": fa.get("flag") or "fatal",
                "message": text[:400],
                "location": fa.get("location") or "",
            }
        )
    return out


def check(proc, xml_path):
    started = time.time()
    try:
        ET.parse(xml_path)
    except ET.ParseError as e:
        return {"wellFormed": False, "error": f"The XML is not well-formed: {e}", "failed": [], "warnings": []}
    except FileNotFoundError:
        return {"wellFormed": False, "error": "map.py did not write out.xml", "failed": [], "warnings": []}
    xp = proc.new_xslt30_processor()
    failed, warnings = [], []
    for name, _version, fname in RULESETS:
        exe = xp.compile_stylesheet(stylesheet_file=f"{VAL}/{fname}")
        for f in failures(exe.transform_to_string(source_file=xml_path), name):
            (failed if f["flag"] == "fatal" else warnings).append(f)
    return {"wellFormed": True, "failed": failed, "warnings": warnings, "ms": round((time.time() - started) * 1000)}


def selftest(proc):
    results = {}
    for name in ("selftest-peppol-base-example.xml", "selftest-bis3-positive.xml"):
        r = check(proc, f"{VAL}/{name}")
        results[name] = sorted({f["id"] for f in r["failed"]})
    base = open(f"{VAL}/selftest-peppol-base-example.xml", encoding="utf-8").read()
    changed = re.sub(
        r"(<cbc:PayableAmount[^>]*>)([0-9.]+)(</cbc:PayableAmount>)", r"\g<1>999.99\g<3>", base, count=1
    )
    with open("/tmp/selftest-changed.xml", "w", encoding="utf-8") as fh:
        fh.write(changed)
    r = check(proc, "/tmp/selftest-changed.xml")
    results["changed-amount-due"] = sorted({f["id"] for f in r["failed"]})
    ok = (
        results["selftest-peppol-base-example.xml"] == []
        and results["selftest-bis3-positive.xml"] == []
        and "BR-CO-16" in results["changed-amount-due"]
    )
    return {"ok": ok, "results": results}


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    with PySaxonProcessor(license=False) as proc:
        if cmd == "compile":
            compile_peppol(proc)
            print(json.dumps({"compiled": True}))
        elif cmd == "check" and len(sys.argv) > 2:
            print(json.dumps(check(proc, sys.argv[2])))
        elif cmd == "selftest":
            r = selftest(proc)
            print(json.dumps(r))
            sys.exit(0 if r["ok"] else 1)
        else:
            print(__doc__)
            sys.exit(2)


if __name__ == "__main__":
    main()

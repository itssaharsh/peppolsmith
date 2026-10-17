# Plants one classic converter bug in a certified Peppol UBL invoice, keeping it internally consistent so the
# official rules still pass. Used by "Try to fool the gates": the reconciliation and provenance gates must hold it.
# Usage: python3 fool.py <cents|discount|buyer_id> in.xml out.xml
import sys
import xml.etree.ElementTree as ET
from decimal import Decimal, ROUND_HALF_UP

NS = {
    "": "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    "cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    "cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
}
for prefix, uri in NS.items():
    ET.register_namespace(prefix, uri)
CAC = "{%s}" % NS["cac"]
CBC = "{%s}" % NS["cbc"]


def q2(d):
    return d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def num(el):
    return Decimal(el.text.strip())


def cents_as_euros(root):
    """A converter that forgets to divide Stripe-style cents by 100: every amount is 100x."""
    for el in root.iter():
        if el.tag.startswith(CBC) and el.tag.endswith("Amount") and el.text and el.text.strip():
            el.text = str(q2(num(el) * 100))


def category(el):
    return (el.findtext(CBC + "ID"), str(Decimal(el.findtext(CBC + "Percent") or "0").normalize()))


def drop_discount(root):
    """A converter that ignores document-level discounts, then totals what is left consistently."""
    dropped = [ac for ac in root.findall(CAC + "AllowanceCharge") if (ac.findtext(CBC + "ChargeIndicator") or "").strip() == "false"]
    if not dropped:
        raise SystemExit("This invoice has no document-level discount to drop.")
    for ac in dropped:
        root.remove(ac)
    taxable = {}
    line_total = Decimal("0")
    for line in root.findall(CAC + "InvoiceLine"):
        amount = num(line.find(CBC + "LineExtensionAmount"))
        line_total += amount
        key = category(line.find(CAC + "Item/" + CAC + "ClassifiedTaxCategory"))
        taxable[key] = taxable.get(key, Decimal("0")) + amount
    charges = Decimal("0")
    for ac in root.findall(CAC + "AllowanceCharge"):
        amount = num(ac.find(CBC + "Amount"))
        charges += amount
        key = category(ac.find(CAC + "TaxCategory"))
        taxable[key] = taxable.get(key, Decimal("0")) + amount
    tax_total = root.find(CAC + "TaxTotal")
    vat = Decimal("0")
    for sub in tax_total.findall(CAC + "TaxSubtotal"):
        key = category(sub.find(CAC + "TaxCategory"))
        base = q2(taxable.get(key, Decimal("0")))
        tax = q2(base * Decimal(key[1]) / 100)
        sub.find(CBC + "TaxableAmount").text = str(base)
        sub.find(CBC + "TaxAmount").text = str(tax)
        vat += tax
    tax_total.find(CBC + "TaxAmount").text = str(q2(vat))
    lmt = root.find(CAC + "LegalMonetaryTotal")
    allowance_total = lmt.find(CBC + "AllowanceTotalAmount")
    if allowance_total is not None:
        lmt.remove(allowance_total)
    exclusive = q2(line_total + charges)
    prepaid = lmt.find(CBC + "PrepaidAmount")
    rounding = lmt.find(CBC + "PayableRoundingAmount")
    lmt.find(CBC + "LineExtensionAmount").text = str(q2(line_total))
    lmt.find(CBC + "TaxExclusiveAmount").text = str(exclusive)
    lmt.find(CBC + "TaxInclusiveAmount").text = str(q2(exclusive + vat))
    payable = exclusive + vat - (num(prepaid) if prepaid is not None else 0) + (num(rounding) if rounding is not None else 0)
    lmt.find(CBC + "PayableAmount").text = str(q2(payable))


def valid_id(scheme):
    """An invented identifier that is well formed for its scheme, so only provenance can catch it."""
    if scheme == "0208":  # Belgian enterprise number, mod 97 check
        body = 1234567
        return "0%07d%02d" % (body, 97 - (body % 97))
    if scheme == "0088":  # GLN, GS1 check digit
        body = "541234500001"
        total = sum(int(d) * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(body)))
        return body + str((10 - total % 10) % 10)
    if scheme == "9930":  # German VAT number
        return "DE123456789"
    return "INVENTED0001"


def invent_buyer_id(root):
    """A converter that makes up a buyer Peppol ID instead of taking the declared one."""
    endpoint = root.find(CAC + "AccountingCustomerParty/" + CAC + "Party/" + CBC + "EndpointID")
    endpoint.text = valid_id(endpoint.get("schemeID"))


MUTATIONS = {"cents": cents_as_euros, "discount": drop_discount, "buyer_id": invent_buyer_id}

if __name__ == "__main__":
    mutation, src, dst = sys.argv[1:4]
    tree = ET.parse(src)
    MUTATIONS[mutation](tree.getroot())
    tree.write(dst, encoding="UTF-8", xml_declaration=True)
    print("ok")

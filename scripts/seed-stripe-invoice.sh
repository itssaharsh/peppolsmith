#!/usr/bin/env bash
# Creates one Stripe TEST-MODE invoice (sandbox) and saves the finalized Invoice JSON as samples/stripe-invoice.json.
# The buyer is fictional. The invoice carries a document-level 10% coupon on purpose: dropping it is the classic
# way a converter passes the official rules but no longer matches what was billed.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! stripe whoami 2>/dev/null | grep -qE "sandbox[[:space:]]+●"; then
  echo "Refusing: the Stripe CLI is not in a sandbox context. Run: stripe switch <acct> (without --live)" >&2
  exit 1
fi

post() { stripe post "$@" 2>/dev/null | grep -v claude-code-hint; }
field() { python3 -c "import json,sys; d=json.load(sys.stdin); v=d.get('$1'); assert v, d.get('error',d); assert d.get('livemode') in (False,None), 'livemode object!'; print(v)"; }

CUS=$(post /v1/customers -d "name=Brasserie De Kaai NV" -d "email=facturen@brasserie-dekaai.example" \
  -d "address[line1]=Kaaiplaats 1" -d "address[postal_code]=2000" -d "address[city]=Antwerpen" -d "address[country]=BE" \
  -d "preferred_locales[]=nl" | field id)
post "/v1/customers/$CUS/tax_ids" -d type=eu_vat -d value=BE0764221032 >/dev/null
TXR=$(post /v1/tax_rates -d "display_name=VAT" -d percentage=21 -d inclusive=false -d country=BE -d "jurisdiction=BE" | field id)
CPN=$(post /v1/coupons -d percent_off=10 -d duration=once -d "name=Opening order 10%" | field id)
INV=$(post /v1/invoices -d customer="$CUS" -d currency=eur -d collection_method=send_invoice -d days_until_due=30 \
  -d "default_tax_rates[]=$TXR" -d "discounts[0][coupon]=$CPN" -d "description=Opening order, Kaaiplaats taproom" | field id)

add_line() { post /v1/invoiceitems -d customer="$CUS" -d invoice="$INV" -d currency=eur -d "description=$1" \
  -d quantity="$2" -d unit_amount_decimal="$3" | field id >/dev/null; }
add_line "Keg of house lager, 30 L" 4 8950
add_line "Draught tap installation" 1 12000
add_line "Glassware rental, box of 24" 2 1500

post "/v1/invoices/$INV/finalize" >/dev/null
stripe get "/v1/invoices/$INV" -d "expand[]=lines.data.discounts" -d "expand[]=total_discount_amounts.discount" 2>/dev/null \
  | grep -v claude-code-hint > samples/stripe-invoice.json
python3 -c "
import json; d=json.load(open('samples/stripe-invoice.json'))
print('saved', d['id'], 'livemode', d['livemode'], 'status', d['status'])
print('subtotal', d['subtotal'], 'discount', [x['amount'] for x in d.get('total_discount_amounts',[])], 'tax', d.get('tax'), 'total', d['total'], 'amount_due', d['amount_due'], d['currency'])
print('lines', [(l['description'], l.get('quantity'), l['amount']) for l in d['lines']['data']])"

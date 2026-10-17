#!/usr/bin/env bash
# Creates a second Stripe TEST-MODE invoice for the same fictional buyer (a follow-up order) and saves it as
# samples/second/stripe-invoice-2.json. The model-off converter runs on it: no model call, same certified map.py.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! stripe whoami 2>/dev/null | grep -qE "sandbox[[:space:]]+●"; then
  echo "Refusing: the Stripe CLI is not in a sandbox context. Run: stripe switch <acct> (without --live)" >&2
  exit 1
fi

post() { stripe post "$@" 2>/dev/null | grep -v claude-code-hint; }
field() { python3 -c "import json,sys; d=json.load(sys.stdin); v=d.get('$1'); assert v, d.get('error',d); assert d.get('livemode') in (False,None), 'livemode object!'; print(v)"; }
first() { python3 -c "import json; d=json.load(open('samples/stripe-invoice.json')); print($1)"; }

CUS=$(first "d['customer']")
TXR=$(first "d['default_tax_rates'][0]['id']")
CPN=$(post /v1/coupons -d percent_off=5 -d duration=once -d "name=Repeat order 5%" | field id)
INV=$(post /v1/invoices -d customer="$CUS" -d currency=eur -d collection_method=send_invoice -d days_until_due=30 \
  -d "default_tax_rates[]=$TXR" -d "discounts[0][coupon]=$CPN" -d "description=Repeat order, Kaaiplaats taproom" | field id)

add_line() { post /v1/invoiceitems -d customer="$CUS" -d invoice="$INV" -d currency=eur -d "description=$1" \
  -d quantity="$2" -d unit_amount_decimal="$3" | field id >/dev/null; }
add_line "Keg of house lager, 30 L" 6 8950
add_line "Keg of seasonal amber, 20 L" 2 7425
add_line "Line cleaning service" 1 4500

post "/v1/invoices/$INV/finalize" >/dev/null
stripe get "/v1/invoices/$INV" -d "expand[]=lines.data.discounts" -d "expand[]=total_discount_amounts.discount" 2>/dev/null \
  | grep -v claude-code-hint > samples/second/stripe-invoice-2.json
python3 -c "
import json; d=json.load(open('samples/second/stripe-invoice-2.json'))
print('saved', d['id'], 'livemode', d['livemode'], 'status', d['status'], 'amount_due', d['amount_due'])"

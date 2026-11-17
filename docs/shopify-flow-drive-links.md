# Drive links on every order (Shopify Flow)

When an order comes in, this Flow workflow writes the Google Drive folder link
for each poster into the order's note. Whoever packs the order can then open
the print files from the order page.

It runs inside Shopify, so it works while Studio is off. It reads the
`custom.drive_folder` product metafield, which Studio fills in when a poster's
files finish uploading to Drive.

## Before you start

- Install **Shopify Flow** from the Shopify App Store. It's free.
- Check that products already have links. Run `npm run check:drive-links` in
  Studio, or open a product in Shopify admin and look for **Drive folder**
  under Metafields.
- Share the root "Litwalls Posters" Drive folder with everyone who fulfils
  orders. The links only open for Google accounts with access.

## Set it up

1. In Shopify admin, go to **Apps → Flow → Create workflow**.
2. **Trigger:** choose **Order created**.
3. **Action:** add **Update order note**. Skip the condition step.
4. In the action's **Note** field, paste this:

   ```liquid
   {{ order.note }}
   {% capture links %}{% for li in order.lineItems %}{% for mf in li.product.metafields %}{% if mf.namespace == "custom" and mf.key == "drive_folder" %}
   {{ li.title }} - {{ li.variantTitle }} x{{ li.quantity }}
   {{ mf.value }}
   {% endif %}{% endfor %}{% endfor %}{% endcapture %}{% if links != blank %}

   Print files (Google Drive):{{ links }}{% endif %}
   ```

   Paste it rather than typing it. The Note editor auto-closes `{{` and
   auto-inserts end tags as you type, which garbles hand-typed Liquid.

5. Name the workflow "Drive links on orders" (**More actions → Rename**) and
   **turn it on**.

> Set up on the Litwalls store on 2026-11-17; the workflow is named
> "Drive links on orders".

The note on an order then looks like this:

```
<any note the customer left>

Print files (Google Drive):
Ferrari F1 #04 | F1 Posters - A3 x1
https://drive.google.com/drive/folders/1AbC...
```

## Why it's written this way

- **`{{ order.note }}` comes first on purpose.** "Update order note"
  *replaces* the note by default, and starting with the existing note is
  Shopify's documented way to append to it. Without that line, a gift message
  or delivery instruction the customer typed would be wiped.
- **It loops over metafields instead of using `product.metafields.custom.drive_folder`.**
  Flow doesn't support dot notation for metafields; looping and matching the
  namespace and key is the documented pattern. If Flow's variable picker
  offers **Drive folder** directly under the line item's product, you can use
  that instead.
- **Products with no link add nothing.** If no line item has a link (for
  example, hand-made products from before Studio), the note is left as it was.

## Test it

1. Place a test order for a product that has a Drive link. A draft order
   marked as paid, or a 100% discount code, both work.
2. Open the order in admin. The note should list the poster and its Drive
   link. Click the link and check it opens the right folder.
3. In Flow, open the workflow's **Run history** to see what happened on each
   run. If the note came out empty or the run failed, it shows why.

## Orders placed before the workflow existed

Flow only runs on new orders. For an older order, open the product from the
line item; the **Drive folder** metafield is on the product page.

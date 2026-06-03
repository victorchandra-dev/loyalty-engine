# LoyaltyFlow — Privacy Policy

**Last updated: 2026-06-03**

---

## 1. Who We Are

LoyaltyFlow is a Shopify app developed and operated by <<FILL: legal entity name (e.g. "Amada Flow Inc." or the registered company name)>>.

**Data controller contact:**
<<FILL: contact email address for privacy inquiries>>

When LoyaltyFlow is installed on a Shopify store, the merchant (the store owner) and <<FILL: legal entity name>> are each data controllers for the personal data described in this policy. Shopify Inc. acts as a data processor on behalf of both parties.

---

## 2. What Data the App Accesses and Why

LoyaltyFlow requests the following Shopify Admin API access scopes. Each scope is used only for the stated purpose and is not used for any other reason.

| Scope | Purpose |
|---|---|
| `read_customers`, `write_customers` | Read customer profiles to look up loyalty state; write loyalty data back to customer metafields. |
| `customer_read_customers` | Supports Customer Account API context for storefront-side loyalty lookups. |
| `read_orders` | Read paid order data transiently in the `orders/paid` webhook to calculate points earned. Read refund data transiently in the `refunds/create` webhook to roll back points debited on returns. Order and refund records are processed in memory and are not retained. |
| `read_discounts`, `write_discounts` | Create and manage the persistent automatic discount that the loyalty discount function uses to apply earned rewards at checkout. |
| `read_metaobjects`, `write_metaobjects` | Read and write loyalty program configuration (tiers, earn rules, redemption options, benefits) stored as metaobjects in the merchant's Shopify store. |
| `read_metaobject_definitions`, `write_metaobject_definitions` | Create and maintain the metaobject type definitions that back the loyalty program configuration. |

---

## 3. What Data We Store and Where

### 3.1 Customer Loyalty Data — Stored in Shopify (not in our database)

All customer-facing loyalty data is stored exclusively as **Shopify customer metafields** on the merchant's own Shopify store, under the app's private namespace (`$app`). The app never copies this data to an external database.

The following five metafields are written per customer:

| Metafield key | Contents |
|---|---|
| `loyalty_state` | Derived loyalty state (tier, qualification details) |
| `loyalty_points_balance` | Current points balance (integer) |
| `loyalty_active_redemption` | Pending redemption reserved for checkout (JSON; includes an expiry timestamp) |
| `loyalty_referred_by` | Referral attribution payload (written once on first sign-in via a referral link) |
| `loyalty_referred_by_credited` | Boolean flag set once the referral bonus has been awarded |

### 3.2 Shop-Level Program Configuration — Stored in Shopify

Loyalty program configuration (tiers, earn rules, redemption catalog) is stored as **Shopify metaobjects** on the merchant's store. A normalized snapshot and operational flags are stored as **shop-level metafields** also on the merchant's Shopify store. None of this data is replicated to our database.

### 3.3 Session / Authentication Records — Stored in Our Database

The app maintains a PostgreSQL database (hosted on Fly.io) solely for Shopify OAuth session management. This database stores **one record per active merchant session**, containing:

- Shopify store domain
- OAuth access token and optional refresh token (used to call the Shopify Admin API on the merchant's behalf)
- Session metadata: scope string, expiry timestamps, online/offline flag
- Merchant staff user fields that Shopify provides during OAuth: `userId`, `firstName`, `lastName`, `email`, `locale`, `accountOwner`, `collaborator`, `emailVerified`

This data pertains to **merchant and merchant-staff users only** — it is the Shopify-standard session record needed to authenticate API calls. No end-customer (shopper) data is stored in this database.

### 3.4 What Is Not Stored

- No shopper PII (names, email addresses, addresses, payment information) is written to our database.
- Order and refund payloads received via webhook are processed in memory to compute a points delta and then discarded. The resulting value is written only as a metafield update in Shopify.

---

## 4. What We Do Not Do

- We do not sell, rent, or trade any merchant or customer data to third parties.
- We do not use customer loyalty data for advertising, profiling, or any purpose beyond operating the loyalty program for the merchant's store.
- We do not share data with any third party other than the sub-processors listed in Section 5.
- We do not build cross-merchant customer profiles.

---

## 5. Sub-Processors and Third Parties

LoyaltyFlow uses the following sub-processors. No others.

### 5.1 Shopify Inc.

All loyalty data (customer metafields, metaobjects, discounts) is stored on Shopify's platform under the merchant's Shopify store. Shopify processes this data as a data processor subject to its own [Data Processing Addendum](https://www.shopify.com/legal/dpa) and privacy policies.

### 5.2 Fly.io

The app's server (including the PostgreSQL session database) is hosted on [Fly.io](https://fly.io). Fly.io processes infrastructure-level data (server logs, network traffic) as a data processor. Application data in transit and at rest is encrypted over HTTPS/TLS.

### 5.3 Sentry (conditional — only if enabled by the operator)

If the `SENTRY_DSN` environment variable is configured on the server, unhandled application errors are reported to [Sentry](https://sentry.io) for monitoring purposes. Error reports may include contextual data such as shop domain and internal identifiers (e.g. customer GID, order GID) attached by the error handler. Sentry is **not active** unless the operator explicitly sets this variable. When not configured, no data is sent to Sentry.

---

## 6. Data Retention and Deletion

### 6.1 Customer Loyalty Data (Shopify Metafields)

Customer loyalty metafields live on the merchant's Shopify store. When Shopify sends a **`customers/redact`** GDPR webhook, the app immediately issues a `metafieldsDelete` mutation via the Shopify Admin API to permanently delete all five loyalty metafields for that customer (`loyalty_state`, `loyalty_points_balance`, `loyalty_active_redemption`, `loyalty_referred_by`, `loyalty_referred_by_credited`).

### 6.2 Session Records

When Shopify sends either an **`app/uninstalled`** webhook or a **`shop/redact`** GDPR webhook, the app deletes all Prisma session records for that shop from the PostgreSQL database. After deletion, the app retains no data about that merchant.

### 6.3 Customer Data Request

When Shopify sends a **`customers/data_request`** GDPR webhook, the app logs the request for audit purposes. Because all loyalty data for the customer resides in Shopify metafields on the merchant's own store, the merchant can export it directly from their Shopify admin. The app holds no additional copy to export.

### 6.4 Retention Period

Session records are retained for as long as the app is installed on the merchant's store and a valid OAuth session exists. There is no separate retention timer; records are deleted on uninstall or shop redact as described above. Customer metafield data follows the retention rules of the merchant's Shopify store.

---

## 7. Customer Rights

End customers (shoppers) exercising data rights (access, erasure, portability) should contact the **merchant** (the store where they shop), as the merchant controls the Shopify store and is the primary data controller for customer data.

Merchants can:
- View and export a customer's loyalty data from the Shopify admin (Customer > Metafields).
- Delete a customer's loyalty data by requesting a customer redact through Shopify's privacy webhook flow, which automatically triggers the app's deletion handler described in Section 6.1.

Merchants seeking to exercise their own data rights as data subjects may contact us at: <<FILL: contact email address>>

---

## 8. Security

- All communications between the app server, Shopify, and the storefront are encrypted over **HTTPS/TLS**.
- Requests from the Hydrogen storefront to the app's API endpoints are authenticated using a **shared secret** verified with a constant-time comparison to prevent timing attacks.
- All incoming Shopify webhooks are authenticated using **HMAC signature verification** before any payload is processed.
- OAuth tokens stored in the session database are used only to make Shopify Admin API calls on behalf of the merchant.

---

## 9. Changes to This Policy

We may update this policy to reflect changes in the app's functionality or applicable law. When we do, we will update the "Last updated" date at the top of this page. Merchants are encouraged to review this policy periodically. Continued use of the app after changes are posted constitutes acceptance of the updated policy.

---

## 10. Contact

For privacy questions, data requests, or concerns, please contact us at:

<<FILL: contact email address>>

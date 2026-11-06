# LoyaltyFlow — Privacy Policy

**Last updated: 2026-11-06**

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
| `read_customers`, `write_customers` | Read customer profiles (including lifetime spend and order count) to work out loyalty state; write loyalty data back to customer metafields. |
| `customer_read_customers` | Supports Customer Account API context for storefront-side loyalty lookups. |
| `read_orders` | Read paid orders in the `orders/paid` webhook to calculate points earned, and refunds in the `refunds/create` webhook to take back points for refunded spend. |
| `read_discounts`, `write_discounts` | Create and manage the automatic tier discounts (each limited to one customer segment) and the single-use discount codes customers receive when they redeem points. |
| `read_metaobjects`, `write_metaobjects` | Read and write loyalty program configuration (tiers, earn rules, rewards, benefits) stored as metaobjects in the merchant's Shopify store. |
| `read_metaobject_definitions`, `write_metaobject_definitions` | Create and maintain the metaobject type definitions that back the loyalty program configuration. |

---

## 3. What Data We Store and Where

### 3.1 Customer Loyalty Data — Stored in Shopify

A customer's current loyalty data is stored as **Shopify customer metafields** on the merchant's own Shopify store, under the app's private namespace (`$app`):

| Metafield key | Contents |
|---|---|
| `loyalty_state` | Derived loyalty state (tier, qualification details) |
| `loyalty_points_balance` | Current points balance (integer) |
| `loyalty_active_redemption` | The customer's unused reward code (JSON; includes an expiry timestamp) |
| `loyalty_referred_by` | Referral attribution (which customer referred them; written once, on a signed-in visit after following a referral link) |
| `loyalty_referred_by_credited` | Flag set once the referral bonus has been paid |

### 3.2 Shop-Level Program Configuration — Stored in Shopify

Loyalty program configuration (tiers, earn rules, rewards) is stored as **Shopify metaobjects** on the merchant's store. A snapshot of it and operational settings are stored as **shop-level metafields**, also on the merchant's Shopify store.

### 3.3 Our Database

The app runs a PostgreSQL database on Google Cloud SQL (region `asia-southeast1`, Singapore), reachable only over Google's private network. It holds three kinds of records:

**Sessions (merchant data).** One record per merchant session, used to call the Shopify Admin API on the merchant's behalf:

- Shopify store domain
- OAuth access token and optional refresh token
- Session metadata: scope string, expiry timestamps, online/offline flag
- Merchant staff fields that Shopify provides during OAuth: `userId`, `firstName`, `lastName`, `email`, `locale`, `accountOwner`, `collaborator`, `emailVerified`

**Points history (customer data).** One record per points change, so the merchant can see how a balance was reached. Each record contains:

- Store domain and the customer's Shopify ID
- Type of change (for example order points, signup bonus, referral bonus, refund, reward redeemed, manual adjustment), points, and the balance after it
- The Shopify order ID, when the change came from an order or refund
- Details of the change: the earn rule, the reward code, the referred customer's Shopify ID (for referral bonuses), or, for manual adjustments, the reason and the name and ID of the staff member who made it
- The date and time

Points history contains no customer names, email addresses, postal addresses or payment information.

**Processed webhooks.** The topic and Shopify ID of each order or refund webhook already handled (for example `orders/paid:gid://shopify/Order/123`), so points are never awarded or taken back twice. These records hold no personal data.

### 3.4 What Is Not Stored

- No shopper names, email addresses, postal addresses or payment information are written to our database.
- Order and refund payloads received by webhook are processed in memory. Only the resulting points change, as described in 3.3, is kept.

### 3.5 Logs

The app server writes operational logs to Google Cloud Logging and errors to Google Cloud Error Reporting. Log lines can include store domains and Shopify customer, order and refund IDs. A `customers/data_request` webhook is logged with the customer's Shopify ID and email address so the request can be acted on. Logs are kept for Cloud Logging's default retention period (30 days) and are not used for any other purpose.

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

Customer metafields, metaobjects and discounts are stored on Shopify's platform under the merchant's Shopify store. Shopify processes this data as a data processor subject to its own [Data Processing Addendum](https://www.shopify.com/legal/dpa) and privacy policies.

### 5.2 Google Cloud

The app's server (Cloud Run), database (Cloud SQL), secrets (Secret Manager) and logs (Cloud Logging, Error Reporting) are hosted on [Google Cloud](https://cloud.google.com) in the `asia-southeast1` (Singapore) region. Google processes this data as a data processor under the [Google Cloud Data Processing Addendum](https://cloud.google.com/terms/data-processing-addendum). Data is encrypted in transit (HTTPS/TLS) and at rest.

---

## 6. Data Retention and Deletion

### 6.1 Customer Redact

When Shopify sends a **`customers/redact`** GDPR webhook, the app:

- deletes all five loyalty metafields for that customer via the Shopify Admin API (`metafieldsDelete`), when the app is still installed;
- deletes all of that customer's points history records from our database;
- removes that customer's ID from the referral bonus records of the customer who referred them.

If any step fails, the app returns an error so Shopify retries the webhook.

### 6.2 Uninstall and Shop Redact

When the app is uninstalled (**`app/uninstalled`** webhook), the app deletes the shop's session records. When Shopify sends the **`shop/redact`** GDPR webhook (48 hours after uninstall), the app deletes all of the shop's points history records and any remaining session records.

### 6.3 Customer Data Request

When Shopify sends a **`customers/data_request`** GDPR webhook, the app logs the request (see 3.5). The merchant can see the customer's loyalty metafields in the Shopify admin and the customer's points history on the customer's page in the app, and send both to the customer.

### 6.4 Retention Period

Session records and points history are kept while the app is installed and deleted as described in 6.1 and 6.2. Processed-webhook records hold no personal data and are kept so that a repeated webhook is recognised. Customer metafield data follows the retention rules of the merchant's Shopify store.

---

## 7. Customer Rights

End customers (shoppers) exercising data rights (access, erasure, portability) should contact the **merchant** (the store where they shop), as the merchant controls the Shopify store and is the primary data controller for customer data.

Merchants can:
- View and export a customer's loyalty data from the Shopify admin (Customer > Metafields) and their points history from the customer's page in the app.
- Delete a customer's loyalty data by requesting a customer redact through Shopify's privacy webhook flow, which automatically triggers the app's deletion handler described in Section 6.1.

Merchants seeking to exercise their own data rights as data subjects may contact us at: <<FILL: contact email address>>

---

## 8. Security

- All communications between the app server, Shopify, and the storefront are encrypted over **HTTPS/TLS**.
- Requests from the Hydrogen storefront to the app's API endpoints are authenticated using a **shared secret** verified with a constant-time comparison, plus a **signed customer token** so a request can only read or change the signed-in customer's own loyalty data.
- All incoming Shopify webhooks are authenticated using **HMAC signature verification** before any payload is processed.
- OAuth tokens stored in the session database are used only to make Shopify Admin API calls on behalf of the merchant.
- The database has no public IP address; only the app server can reach it. Secrets are kept in Google Secret Manager.

---

## 9. Changes to This Policy

We may update this policy to reflect changes in the app's functionality or applicable law. When we do, we will update the "Last updated" date at the top of this page. Merchants are encouraged to review this policy periodically. Continued use of the app after changes are posted constitutes acceptance of the updated policy.

---

## 10. Contact

For privacy questions, data requests, or concerns, please contact us at:

<<FILL: contact email address>>

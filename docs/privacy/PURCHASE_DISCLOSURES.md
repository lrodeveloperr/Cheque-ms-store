# Purchase disclosures

## English — Store listing and in-app disclosure

**In-app purchases:** Lifetime Unlock is a one-time, non-expiring digital add-on. It is not a subscription and does not renew. The first three distinct real cheques are free. Watermarked non-negotiable samples and calibration sheets are unlimited and do not count toward the limit. Lifetime Unlock permits unlimited real cheque output in the supported app. Microsoft Store displays and processes the current localized price, taxes, payment, licence and refund request. A Microsoft account and internet connection may be required to purchase or restore. Existing local records, exports, backups and confirmation of an already queued print remain available without purchase.

**Launch catalog targets:** USD 19.99 in the United States; CAD 25.99 in Canada. Do not hard-code these figures in the purchase button or runtime price label. Display `StoreProduct.Price.FormattedPrice` verbatim.

**Not included:** no subscription, renewal, advertising, cloud storage, bank connection, blank-stock MICR printing or guarantee of bank acceptance.

## Français (Canada) — fiche du Store et avis dans l’application

**Achats intégrés :** Le déverrouillage à vie est un module numérique unique sans expiration. Il ne s’agit pas d’un abonnement et il ne se renouvelle pas. Les trois premiers vrais chèques distincts sont gratuits. Les spécimens filigranés non négociables et les feuilles de calibrage sont illimités et ne comptent pas. Le déverrouillage à vie permet un nombre illimité de vrais chèques dans les fonctions prises en charge. Le Microsoft Store affiche et traite le prix localisé actuel, les taxes, le paiement, la licence et les demandes de remboursement. Un compte Microsoft et une connexion Internet peuvent être requis pour acheter ou restaurer. Les données locales existantes, les exportations, les sauvegardes et la confirmation d’une impression déjà mise en file demeurent accessibles sans achat.

**Prix cibles de lancement :** 19,99 USD aux États-Unis; 25,99 CAD au Canada. Ne codez pas ces montants dans le bouton d’achat ni dans l’étiquette de prix à l’exécution. Affichez textuellement `StoreProduct.Price.FormattedPrice`.

**Non compris :** aucun abonnement, renouvellement, publicité, stockage infonuagique, connexion bancaire, impression de caractères magnétiques sur papier vierge ni garantie d’acceptation par une institution financière.

## Review-note facts

- Product ID: `lifetime_unlock`.
- Product type: Durable.
- Duration: never expires.
- Purchase is granted only after a fresh active-license query.
- Restore purchase is in Settings → Lifetime Unlock.
- Store-context purchase UI is owned by the main HWND.
- Testing requires a Store-associated package flight; `Windows.Services.Store` does not provide a local simulator.

Microsoft Store policy requires the metadata and App to disclose the type and price range of in-product purchases and make clear when the user initiates a purchase: [Microsoft Store Policies, section 10.8.4](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies).

import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { loadHostCatalogs } from "../../src/product/catalog-loader.ts";
import { CUSTOMER_STATE_MODEL } from "../../src/product/customer-states.ts";
import { FIRST_LIVE_CHEQUE_FLOW, ONBOARDING_FLOW, PRIMARY_NAVIGATION, ROUTES } from "../../src/product/navigation.ts";
import { DEFERRED_HOST_LOCALES, FREE_LIVE_CHEQUE_LIMIT, LAUNCH_HOST_LOCALES, STORE_PRODUCT, validatePartnerCenterIdentity } from "../../src/product/product-identity.ts";

test("Store identity, add-on model and locked catalog targets are explicit", () => {
  assert.equal(STORE_PRODUCT.storeTitle, "Check Printer & Check Writer");
  assert.equal(STORE_PRODUCT.storeTitle.length, 28);
  assert.equal(STORE_PRODUCT.publisherDisplayName, "WorksBien Studios Inc.");
  assert.equal(STORE_PRODUCT.lifetimeAddOn.inAppOfferToken, "lifetime_unlock");
  assert.equal(STORE_PRODUCT.lifetimeAddOn.productKind, "DURABLE");
  assert.equal(STORE_PRODUCT.lifetimeAddOn.duration, "NEVER_EXPIRES");
  assert.equal(STORE_PRODUCT.lifetimeAddOn.storeId, undefined);
  assert.deepEqual(STORE_PRODUCT.targetCatalogPrices, { US: { currency: "USD", minorUnits: 1999 }, CA: { currency: "CAD", minorUnits: 2599 } });
  assert.equal(FREE_LIVE_CHEQUE_LIMIT, 3);
});

test("Partner Center placeholder is rejected and the generated Store IDs are mandatory", () => {
  assert.ok(validatePartnerCenterIdentity({
    packageIdentityName: STORE_PRODUCT.packageIdentityNamePlaceholder,
    packageFamilyName: "placeholder_family",
    publisherSubject: "CN=placeholder",
    appStoreId: "",
    lifetimeAddOnStoreId: "",
  }).length >= 3);
});

test("launch locales are exactly US English, Canadian English and Canadian French", () => {
  assert.deepEqual([...LAUNCH_HOST_LOCALES], ["en-US", "en-CA", "fr-CA"]);
  assert.deepEqual([...DEFERRED_HOST_LOCALES], ["es-US"]);
});

test("Windows packages and the in-app brand use approved printer-and-check artwork", async () => {
  const forge = await readFile(new URL("../../packaging/forge.config.cjs", import.meta.url), "utf8");
  const shell = await readFile(new URL("../../src/ui/index.html", import.meta.url), "utf8");
  assert.match(forge, /resources\/app-icon\.ico/);
  assert.match(forge, /resources\/msix-assets/);
  assert.match(shell, /assets\/brand-mark\.svg/);
  assert.doesNotMatch(shell, /ti-printer/);

  const assets = [
    "LockScreenLogo.scale-200.png",
    "SplashScreen.scale-200.png",
    "Square150x150Logo.png",
    "Square150x150Logo.scale-200.png",
    "Square44x44Logo.png",
    "Square44x44Logo.scale-200.png",
    "Square44x44Logo.targetsize-24_altform-unplated.png",
    "Wide310x150Logo.scale-200.png",
    "icon.png",
  ];
  await access(new URL("../../resources/app-icon.ico", import.meta.url));
  await access(new URL("../../resources/app-icon.svg", import.meta.url));
  await access(new URL("../../src/ui/assets/brand-mark.svg", import.meta.url));
  await Promise.all(assets.map((asset) => access(new URL(`../../resources/msix-assets/${asset}`, import.meta.url))));
});

test("resolved host catalogs have identical non-empty keys and every state/route/action key", async () => {
  const catalogs = await loadHostCatalogs();
  const keys = Object.keys(catalogs["en-US"]).sort();
  for (const locale of LAUNCH_HOST_LOCALES) {
    assert.deepEqual(Object.keys(catalogs[locale]).sort(), keys);
    for (const [key, value] of Object.entries(catalogs[locale])) assert.ok(value.trim(), `${locale}:${key}`);
  }
  for (const route of ROUTES) {
    for (const locale of LAUNCH_HOST_LOCALES) assert.ok(catalogs[locale][route.titleKey], `${locale}:${route.titleKey}`);
  }
  for (const state of CUSTOMER_STATE_MODEL) {
    for (const locale of LAUNCH_HOST_LOCALES) {
      assert.ok(catalogs[locale][state.titleKey], `${locale}:${state.titleKey}`);
      assert.ok(catalogs[locale][state.bodyKey], `${locale}:${state.bodyKey}`);
      if (state.primaryActionKey) assert.ok(catalogs[locale][state.primaryActionKey], `${locale}:${state.primaryActionKey}`);
      if (state.secondaryActionKey) assert.ok(catalogs[locale][state.secondaryActionKey], `${locale}:${state.secondaryActionKey}`);
    }
  }
});

test("every customer feature has idle, loading, empty, warning, error and success states", () => {
  const required = ["IDLE", "LOADING", "EMPTY", "WARNING", "ERROR", "SUCCESS"];
  for (const feature of new Set(CUSTOMER_STATE_MODEL.map((state) => state.feature))) {
    assert.deepEqual(CUSTOMER_STATE_MODEL.filter((state) => state.feature === feature).map((state) => state.kind).sort(), [...required].sort());
  }
  assert.equal(new Set(CUSTOMER_STATE_MODEL.map((state) => state.id)).size, CUSTOMER_STATE_MODEL.length);
});

test("navigation has one calm five-destination shell and complete first-run/print paths", () => {
  assert.deepEqual([...PRIMARY_NAVIGATION], ["HOME", "CHEQUES", "REGISTER", "PAYEES", "SETTINGS"]);
  assert.equal(ONBOARDING_FLOW[0], "ONBOARDING_WELCOME");
  assert.equal(ONBOARDING_FLOW.at(-1), "HOME");
  assert.deepEqual([...FIRST_LIVE_CHEQUE_FLOW], ["HOME", "CHEQUE_NEW", "CHEQUE_REVIEW", "CHEQUE_OUTPUT", "PRINT_OUTCOME", "CHEQUE_SUCCESS", "REGISTER"]);
  const routeIds = new Set(ROUTES.map((route) => route.id));
  for (const route of [...ONBOARDING_FLOW, ...FIRST_LIVE_CHEQUE_FLOW, ...PRIMARY_NAVIGATION]) assert.ok(routeIds.has(route));
});

test("the native bridge source uses StoreContext, HWND ownership and FormattedPrice", async () => {
  const program = await readFile(new URL("../../src/product/store-bridge/Program.cs", import.meta.url), "utf8");
  assert.match(program, /StoreContext\.GetDefault/);
  assert.match(program, /InitializeWithWindow\.Initialize/);
  assert.match(program, /GetStoreProductsAsync/);
  assert.match(program, /GetStoreProductForCurrentAppAsync/);
  assert.match(program, /APP_STORE_ID_MISMATCH/);
  assert.match(program, /Price\.FormattedPrice/);
  assert.match(program, /RequestPurchaseAsync/);
  assert.match(program, /GetAppLicenseAsync/);
  assert.match(program, /WORKSBIEN_LIFETIME_STORE_ID/);
  assert.match(program, /storeId,\s*\n\s*inAppOfferToken = license\.InAppOfferToken/);
  assert.doesNotMatch(program, /SkuStoreId\.Split/);
  assert.match(program, /StorePurchaseStatus\.NetworkError[\s\S]*Failure\("OFFLINE", true/);
  assert.match(program, /StorePurchaseStatus\.ServerError[\s\S]*Failure\("STORE_UNAVAILABLE", true/);
});

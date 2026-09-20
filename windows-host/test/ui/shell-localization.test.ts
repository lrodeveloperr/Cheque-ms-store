import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { createUiLocalizer, type UiCatalog, type UiCatalogBundle } from "../../src/ui/i18n.ts";
import { applyOperationsDeskLocalization } from "../../src/ui/shell.ts";

const localizationDirectory = join(process.cwd(), "localization");

function catalog(file: string): UiCatalog {
  return JSON.parse(readFileSync(join(localizationDirectory, file), "utf8")) as UiCatalog;
}

const catalogs: UiCatalogBundle = {
  enUS: catalog("en-US.json"),
  enCAOverrides: catalog("en-CA.overrides.json"),
  frCA: catalog("fr-CA.json"),
};

interface FakeElement {
  dataset: Record<string, string>;
  textContent: string;
  attributes: Record<string, string>;
  setAttribute(name: string, value: string): void;
}

function element(dataset: Record<string, string>): FakeElement {
  return {
    dataset,
    textContent: "",
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  };
}

function localizationFixture(): {
  root: Document;
  navigation: FakeElement;
  brandPrimary: FakeElement;
  brandSecondary: FakeElement;
  freeRemaining: FakeElement;
  sidebar: FakeElement;
  brand: FakeElement;
  route: FakeElement;
} {
  const navigation = element({ i18n: "nav.cheques" });
  const brandPrimary = element({ i18n: "app.brandPrimary" });
  const brandSecondary = element({ i18n: "app.brandSecondary" });
  const freeRemaining = element({ i18nCount: "home.freeRemaining", i18nCountValue: "3" });
  const sidebar = element({ i18nAriaLabel: "a11y.sidebar" });
  const brand = element({ i18nAriaLabel: "app.name" });
  const route = element({ i18nRouteTitle: "route.newCheque" });
  const root = {
    documentElement: { lang: "", dir: "" },
    title: "",
    querySelectorAll(selector: string) {
      if (selector === "[data-i18n]") return [navigation, brandPrimary, brandSecondary];
      if (selector === "[data-i18n-count]") return [freeRemaining];
      if (selector === "[data-i18n-aria-label]") return [sidebar, brand];
      if (selector === "[data-i18n-route-title]") return [route];
      return [];
    },
  } as unknown as Document;
  return { root, navigation, brandPrimary, brandSecondary, freeRemaining, sidebar, brand, route };
}

test("Operations Desk shell switches every binding type across all launch locales", () => {
  const fixture = localizationFixture();
  const expectations = [
    ["en-US", "Checks", "Check Printer", "Check Writer", "3 free real checks remain."],
    ["en-CA", "Cheques", "Check Printer", "Check Writer", "3 free real cheques remain."],
    ["fr-CA", "Chèques", "Impression de chèques", "Rédaction de chèques", "Il reste 3 vrais chèques gratuits."],
  ] as const;

  for (const [locale, navigation, brandPrimary, brandSecondary, freeRemaining] of expectations) {
    const localizer = createUiLocalizer(catalogs, locale);
    applyOperationsDeskLocalization(localizer, fixture.root);
    assert.equal(fixture.root.documentElement.lang, locale);
    assert.equal(fixture.navigation.textContent, navigation);
    assert.equal(fixture.brandPrimary.textContent, brandPrimary);
    assert.equal(fixture.brandSecondary.textContent, brandSecondary);
    assert.equal(fixture.freeRemaining.textContent, freeRemaining);
    assert.equal(fixture.sidebar.attributes["aria-label"], localizer.text("a11y.sidebar"));
    assert.equal(fixture.brand.attributes["aria-label"], localizer.text("app.name"));
    assert.equal(fixture.route.dataset.routeTitle, localizer.text("route.newCheque"));
  }
});

test("every static shell localization binding resolves in all launch locales", () => {
  const source = readFileSync(join(process.cwd(), "src/ui/index.html"), "utf8");
  const directKeys = [...source.matchAll(/data-i18n(?:-aria-label|-route-title)?="([^"]+)"/g)].map((match) => match[1]!);
  const countKeys = [...source.matchAll(/data-i18n-count="([^"]+)"/g)].map((match) => match[1]!);
  assert.ok(directKeys.length >= 35, "shell should bind all visible static copy and ARIA labels");
  for (const locale of ["en-US", "en-CA", "fr-CA"] as const) {
    const localizer = createUiLocalizer(catalogs, locale);
    for (const key of directKeys) assert.doesNotThrow(() => localizer.text(key), `${locale}: ${key}`);
    for (const key of countKeys) assert.doesNotThrow(() => localizer.count(key, 3), `${locale}: ${key}`);
  }
});

test("shell styles include programmatic accessibility preference and text-reflow modes", () => {
  const source = readFileSync(join(process.cwd(), "src/ui/styles.css"), "utf8");
  assert.match(source, /html\.forced-colors/);
  assert.match(source, /html\.reduced-motion/);
  assert.match(source, /html\.text-scale-200/);
  assert.match(source, /white-space:\s*normal/);
  assert.match(source, /text-overflow:\s*clip/);
});

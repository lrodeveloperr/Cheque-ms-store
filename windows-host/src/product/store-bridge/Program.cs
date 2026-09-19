using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Windows.ApplicationModel;
using Windows.Services.Store;

namespace WorksBien.StoreBridge;

internal static partial class Program
{
    private const int MaxRequestsPerProcess = 32;
    private const int MaxRequestCharacters = 16_384;
    private const string ExpectedOfferToken = "lifetime_unlock";
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    [GeneratedRegex("^[A-Z0-9]{12}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex StoreIdPattern();

    public static async Task<int> Main()
    {
        string? configuredStoreId = Environment.GetEnvironmentVariable("WORKSBIEN_LIFETIME_STORE_ID");
        string? configuredAppStoreId = Environment.GetEnvironmentVariable("WORKSBIEN_APP_STORE_ID");
        string? configuredIdentityName = Environment.GetEnvironmentVariable("WORKSBIEN_PACKAGE_IDENTITY_NAME");
        string? configuredFamilyName = Environment.GetEnvironmentVariable("WORKSBIEN_PACKAGE_FAMILY_NAME");
        string? configuredPublisher = Environment.GetEnvironmentVariable("WORKSBIEN_PUBLISHER_SUBJECT");
        if (!ValidStoreId(configuredStoreId) ||
            !ValidStoreId(configuredAppStoreId) ||
            string.IsNullOrWhiteSpace(configuredIdentityName) ||
            string.IsNullOrWhiteSpace(configuredFamilyName) ||
            string.IsNullOrWhiteSpace(configuredPublisher))
        {
            await WriteAsync(Failure("PACKAGE_IDENTITY_MISSING", false, "LIFETIME_STORE_ID_NOT_CONFIGURED"));
            return 2;
        }

        if (!HasPackageIdentity(out string? packageIdentityName, out string? packageFamilyName))
        {
            await WriteAsync(Failure("PACKAGE_IDENTITY_MISSING", false, "PACKAGE_CURRENT_UNAVAILABLE"));
            return 3;
        }

        StoreContext context = StoreContext.GetDefault();
        nint initializedHwnd = 0;
        for (int count = 0; count < MaxRequestsPerProcess; count++)
        {
            string? line = await Console.In.ReadLineAsync();
            if (line is null) return 0;
            if (line.Length == 0 || line.Length > MaxRequestCharacters)
            {
                await WriteAsync(Failure("INVALID_STORE_RESPONSE", false, "REQUEST_SIZE_INVALID"));
                continue;
            }

            BridgeRequest? request;
            try
            {
                request = JsonSerializer.Deserialize<BridgeRequest>(line, JsonOptions);
            }
            catch (JsonException)
            {
                await WriteAsync(Failure("INVALID_STORE_RESPONSE", false, "REQUEST_JSON_INVALID"));
                continue;
            }

            if (request is null || request.StoreId != configuredStoreId)
            {
                await WriteAsync(Failure("PRODUCT_NOT_FOUND", false, "STORE_ID_MISMATCH"));
                continue;
            }

            if (request.Hwnd > 0 && initializedHwnd != request.Hwnd)
            {
                try
                {
                    WinRT.Interop.InitializeWithWindow.Initialize(context, (nint)request.Hwnd);
                    initializedHwnd = (nint)request.Hwnd;
                }
                catch (Exception ex)
                {
                    await WriteAsync(Failure("WINDOW_OWNER_MISSING", false, HResult(ex)));
                    continue;
                }
            }

            try
            {
                BridgeResponse response = request.Action switch
                {
                    "readiness" => await ReadinessAsync(
                        context,
                        configuredStoreId,
                        configuredAppStoreId,
                        configuredIdentityName,
                        configuredFamilyName,
                        configuredPublisher,
                        packageIdentityName!,
                        packageFamilyName!,
                        initializedHwnd),
                    "getProduct" => await GetProductAsync(context, configuredStoreId),
                    "getLicense" => await GetLicenseAsync(context, configuredStoreId),
                    "purchase" when initializedHwnd == 0 => Failure("WINDOW_OWNER_MISSING", false),
                    "purchase" => await PurchaseAsync(context, configuredStoreId),
                    _ => Failure("INVALID_STORE_RESPONSE", false, "ACTION_UNKNOWN")
                };
                await WriteAsync(response);
            }
            catch (Exception ex)
            {
                await WriteAsync(MapException(ex));
            }
        }

        return 0;
    }

    private static async Task<BridgeResponse> ReadinessAsync(
        StoreContext context,
        string lifetimeStoreId,
        string configuredAppStoreId,
        string configuredIdentityName,
        string configuredFamilyName,
        string configuredPublisher,
        string actualIdentityName,
        string actualFamilyName,
        nint initializedHwnd)
    {
        string actualPublisher = Package.Current.Id.Publisher;
        if (!string.Equals(actualIdentityName, configuredIdentityName, StringComparison.Ordinal) ||
            !string.Equals(actualFamilyName, configuredFamilyName, StringComparison.Ordinal) ||
            !string.Equals(actualPublisher, configuredPublisher, StringComparison.Ordinal))
        {
            return Failure("PACKAGE_IDENTITY_MISSING", false, "PACKAGE_IDENTITY_MISMATCH");
        }

        StoreProduct currentProduct = await context.GetStoreProductForCurrentAppAsync();
        if (!string.Equals(currentProduct.StoreId, configuredAppStoreId, StringComparison.OrdinalIgnoreCase))
        {
            return Failure("PACKAGE_IDENTITY_MISSING", false, "APP_STORE_ID_MISMATCH");
        }

        return Success(new
        {
            packaged = true,
            storeAssociated = true,
            hwndOwnerInitialized = initializedHwnd != 0,
            identity = new
            {
                packageIdentityName = actualIdentityName,
                packageFamilyName = actualFamilyName,
                publisherSubject = actualPublisher,
                appStoreId = currentProduct.StoreId,
                lifetimeAddOnStoreId = lifetimeStoreId
            }
        });
    }

    private static async Task<BridgeResponse> GetProductAsync(StoreContext context, string storeId)
    {
        StoreProductQueryResult result = await context.GetStoreProductsAsync(
            new[] { "Durable" },
            new[] { storeId });
        if (result.ExtendedError is not null)
        {
            return MapException(result.ExtendedError);
        }
        if (!result.Products.TryGetValue(storeId, out StoreProduct? product))
        {
            return Failure("PRODUCT_NOT_FOUND", false);
        }
        if (!string.Equals(product.InAppOfferToken, ExpectedOfferToken, StringComparison.Ordinal))
        {
            return Failure("INVALID_STORE_RESPONSE", false, "OFFER_TOKEN_MISMATCH");
        }
        if (!string.Equals(product.ProductKind, "Durable", StringComparison.OrdinalIgnoreCase))
        {
            return Failure("INVALID_STORE_RESPONSE", false, "PRODUCT_NOT_DURABLE");
        }
        if (string.IsNullOrWhiteSpace(product.Price.FormattedPrice))
        {
            return Failure("INVALID_STORE_RESPONSE", false, "FORMATTED_PRICE_MISSING");
        }

        return Success(new
        {
            storeId = product.StoreId,
            inAppOfferToken = product.InAppOfferToken,
            productKind = "DURABLE",
            title = product.Title,
            price = new
            {
                formattedPrice = product.Price.FormattedPrice,
                currencyCode = product.Price.CurrencyCode,
                fetchedAt = DateTimeOffset.UtcNow.ToString("O")
            },
            isInUserCollection = product.IsInUserCollection
        });
    }

    private static async Task<BridgeResponse> GetLicenseAsync(StoreContext context, string storeId)
    {
        StoreAppLicense appLicense = await context.GetAppLicenseAsync();
        if (!appLicense.AddOnLicenses.TryGetValue(storeId, out StoreLicense? license))
        {
            return Success(new
            {
                storeId,
                inAppOfferToken = ExpectedOfferToken,
                isActive = false,
                checkedAt = DateTimeOffset.UtcNow.ToString("O")
            });
        }
        if (!string.Equals(license.InAppOfferToken, ExpectedOfferToken, StringComparison.Ordinal))
        {
            return Failure("INVALID_STORE_RESPONSE", false, "LICENSE_TOKEN_MISMATCH");
        }

        // A configured non-expiring Durable add-on must never be converted into
        // a host-managed subscription. The Store license's finite expiration is
        // therefore not surfaced as an app entitlement.
        return Success(new
        {
            // The AddOnLicenses dictionary key is the configured add-on product
            // Store ID. SkuStoreId identifies the SKU and is not interchangeable.
            storeId,
            inAppOfferToken = license.InAppOfferToken,
            isActive = license.IsActive,
            checkedAt = DateTimeOffset.UtcNow.ToString("O")
        });
    }

    private static async Task<BridgeResponse> PurchaseAsync(StoreContext context, string storeId)
    {
        StorePurchaseResult result = await context.RequestPurchaseAsync(storeId);
        if (result.ExtendedError is not null)
        {
            return MapException(result.ExtendedError);
        }

        if (result.Status == StorePurchaseStatus.NetworkError)
        {
            return Failure("OFFLINE", true, "STORE_PURCHASE_NETWORK_ERROR");
        }
        if (result.Status == StorePurchaseStatus.ServerError)
        {
            return Failure("STORE_UNAVAILABLE", true, "STORE_PURCHASE_SERVER_ERROR");
        }

        string status = result.Status switch
        {
            StorePurchaseStatus.Succeeded => "SUCCEEDED",
            StorePurchaseStatus.AlreadyPurchased => "ALREADY_PURCHASED",
            StorePurchaseStatus.NotPurchased => "NOT_PURCHASED",
            _ => "NOT_PURCHASED"
        };
        return Success(new
        {
            status,
            completedAt = DateTimeOffset.UtcNow.ToString("O")
        });
    }

    private static bool HasPackageIdentity(out string? name, out string? familyName)
    {
        try
        {
            name = Package.Current.Id.Name;
            familyName = Package.Current.Id.FamilyName;
            return !string.IsNullOrWhiteSpace(name) && !string.IsNullOrWhiteSpace(familyName);
        }
        catch
        {
            name = null;
            familyName = null;
            return false;
        }
    }

    private static bool ValidStoreId(string? value) =>
        value is not null && StoreIdPattern().IsMatch(value);

    private static BridgeResponse MapException(Exception ex)
    {
        uint code = unchecked((uint)ex.HResult);
        return code switch
        {
            0x80072EE7 or 0x80072EFD or 0x80072EFE => Failure("OFFLINE", true, HResult(ex)),
            0x803F6107 => Failure("PACKAGE_IDENTITY_MISSING", false, HResult(ex)),
            _ => Failure("STORE_UNAVAILABLE", true, HResult(ex))
        };
    }

    private static string HResult(Exception ex) => $"0x{unchecked((uint)ex.HResult):X8}";

    private static BridgeResponse Success(object value) => new(true, value, null, null, false);
    private static BridgeResponse Failure(string code, bool retryable, string? diagnostic = null) =>
        new(false, null, code, diagnostic, retryable);

    private static async Task WriteAsync(BridgeResponse response)
    {
        string json = JsonSerializer.Serialize(response, JsonOptions);
        await Console.Out.WriteLineAsync(json);
        await Console.Out.FlushAsync();
    }

    private sealed record BridgeRequest(string Action, string StoreId, long Hwnd = 0);
    private sealed record BridgeResponse(
        bool Ok,
        object? Value,
        string? Code,
        string? DiagnosticCode,
        bool Retryable);
}

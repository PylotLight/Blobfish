/* Signs normalized SAS params with a shared key. Electron-free (tested directly). */
import { blobApi } from "./azure-clients";
import type { SharedKey } from "./shared-key";
import type {
  NormalizedAccountSas,
  NormalizedContainerSas,
  SasProtocolChoice,
} from "../shared/sas";

function sdkProtocol(p: SasProtocolChoice) {
  const { SASProtocol } = blobApi();
  return p === "https" ? SASProtocol.Https : SASProtocol.HttpsAndHttp;
}

function credential(key: SharedKey) {
  return new (blobApi().StorageSharedKeyCredential)(
    key.accountName,
    key.accountKey,
  );
}

/** Account SAS query string (no leading `?`). */
export function signAccountSas(
  key: SharedKey,
  n: NormalizedAccountSas,
): string {
  const sdk = blobApi();
  return sdk
    .generateAccountSASQueryParameters(
      {
        startsOn: n.startsOn,
        expiresOn: n.expiresOn,
        permissions: sdk.AccountSASPermissions.parse(n.permissions),
        services: sdk.AccountSASServices.parse(n.services).toString(),
        resourceTypes: sdk.AccountSASResourceTypes.parse(
          n.resourceTypes,
        ).toString(),
        protocol: sdkProtocol(n.protocol),
        ipRange: n.ipRange,
      },
      credential(key),
    )
    .toString();
}

/** Container (service) SAS query string, optionally bound to a stored access policy. */
export function signContainerSas(
  key: SharedKey,
  n: NormalizedContainerSas,
): string {
  const sdk = blobApi();
  return sdk
    .generateBlobSASQueryParameters(
      {
        containerName: n.container,
        startsOn: n.startsOn,
        expiresOn: n.expiresOn,
        permissions: n.permissions
          ? sdk.ContainerSASPermissions.parse(n.permissions)
          : undefined,
        identifier: n.identifier,
        protocol: sdkProtocol(n.protocol),
        ipRange: n.ipRange,
      },
      credential(key),
    )
    .toString();
}

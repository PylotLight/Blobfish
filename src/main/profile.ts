import { app } from "electron";
import { dirname, join } from "node:path";
import { APP_NAME } from "../shared/config";
import { resolveProfileName, usesDefaultUserData } from "../shared/profile";

/**
 * Applied on import. index.ts imports this before anything reads userData or
 * takes the single-instance lock, so a dev run lives in "Blobfish Dev" and
 * leaves the release app's state alone.
 */
const profileName = resolveProfileName({
  appName: APP_NAME,
  isPackaged: app.isPackaged,
  profileEnv: process.env["BLOBFISH_PROFILE"],
});

if (
  profileName &&
  usesDefaultUserData(dirname(app.getPath("userData")), app.getPath("appData"))
) {
  app.setName(profileName);
  app.setPath("userData", join(app.getPath("appData"), profileName));
  // Keychain ACLs pin to the binary's signature; the dev Electron is ad-hoc
  // signed and changes every bump, so "Always Allow" never sticks. Dev
  // profiles use Chromium's mock keychain (throwaway dev secrets only).
  // BLOBFISH_REAL_KEYCHAIN=1 opts out.
  if (
    process.platform === "darwin" &&
    !app.isPackaged &&
    process.env["BLOBFISH_REAL_KEYCHAIN"] !== "1"
  )
    app.commandLine.appendSwitch("use-mock-keychain");
  console.log(
    `[blobfish] profile "${profileName}" — userData ${app.getPath("userData")}`,
  );
}

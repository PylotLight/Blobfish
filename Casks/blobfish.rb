# Updated automatically by .github/workflows/release.yml on every release.
# Edit Casks/blobfish.rb.tmpl instead — this file is rendered from it.
cask "blobfish" do
  arch arm: "arm64", intel: "x64"

  version "0.1.1"
  sha256 arm:   "84b6679403a2637c289797c80cadc9706ed821e600613ded04159393d575dca0",
         intel: "bc113857caf237992fa44414670a39ad033bb057ec9912ce480bd72be587d63c"

  url "https://github.com/PylotLight/Blobfish/releases/download/v#{version}/Blobfish-#{version}-mac-#{arch}.zip"
  name "Blobfish"
  desc "Fast native Azure Blob Storage explorer"
  homepage "https://github.com/PylotLight/Blobfish"

  depends_on macos: :monterey

  app "Blobfish.app"

  caveats <<~EOS
    Blobfish is unsigned. If macOS reports it is "damaged", run:
      xattr -cr /Applications/Blobfish.app
    (Homebrew removed the --no-quarantine flag in v6, so clearing the
    quarantine flag manually is now required.)
  EOS

  zap trash: [
    "~/Library/Application Support/Blobfish",
    "~/Library/Caches/com.pylotlight.blobfish",
    "~/Library/HTTPStorages/com.pylotlight.blobfish",
    "~/Library/Preferences/com.pylotlight.blobfish.plist",
    "~/Library/Saved Application State/com.pylotlight.blobfish.savedState",
  ]
end

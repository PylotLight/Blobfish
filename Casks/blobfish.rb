# Updated automatically by .github/workflows/release.yml on every release.
# Edit Casks/blobfish.rb.tmpl instead — this file is rendered from it.
cask "blobfish" do
  arch arm: "arm64", intel: "x64"

  version "0.1.0"
  sha256 arm:   "0000000000000000000000000000000000000000000000000000000000000000",
         intel: "0000000000000000000000000000000000000000000000000000000000000000"

  url "https://github.com/PylotLight/Blobfish/releases/download/v#{version}/Blobfish-#{version}-mac-#{arch}.zip",
      verified: "github.com/PylotLight/Blobfish/"
  name "Blobfish"
  desc "Fast native Azure Blob Storage explorer"
  homepage "https://github.com/PylotLight/Blobfish"

  depends_on macos: ">= :monterey"

  app "Blobfish.app"

  zap trash: [
    "~/Library/Application Support/Blobfish",
    "~/Library/Caches/com.pylotlight.blobfish",
    "~/Library/HTTPStorages/com.pylotlight.blobfish",
    "~/Library/Preferences/com.pylotlight.blobfish.plist",
    "~/Library/Saved Application State/com.pylotlight.blobfish.savedState",
  ]
end

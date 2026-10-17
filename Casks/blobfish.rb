# Updated automatically by .github/workflows/release.yml on every release.
# Edit Casks/blobfish.rb.tmpl instead — this file is rendered from it.
cask "blobfish" do
  arch arm: "arm64", intel: "x64"

  version "0.2.4"
  sha256 arm:   "7a0a144aa1a3eae4c7ad49d604303af01e7a9aca086454255f9192e5144bf2f2",
         intel: "06583d762c71d96381cae24c116ee94743bd45e1afe5969207ae15c62dcde04c"

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

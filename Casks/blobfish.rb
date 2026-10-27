# Updated automatically by .github/workflows/release.yml on every release.
# Edit Casks/blobfish.rb.tmpl instead — this file is rendered from it.
cask "blobfish" do
  version "0.3.0-beta.3"
  sha256 "0edd5b5ca14904f5836dce7bf5b59bf16b6050d6bf9bcbbb91ed8180bc48cc65"

  url "https://github.com/PylotLight/Blobfish/releases/download/v#{version}/Blobfish-#{version}-mac-arm64.zip"
  name "Blobfish"
  desc "Fast native Azure Blob Storage explorer"
  homepage "https://github.com/PylotLight/Blobfish"

  depends_on arch: :arm64
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

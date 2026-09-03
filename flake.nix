{
  description = "QueryMT Desktop development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    rust-overlay.url = "github:oxalica/rust-overlay";
  };

  outputs = inputs:
    inputs.flake-parts.lib.mkFlake {inherit inputs;} {
      systems = inputs.nixpkgs.lib.systems.flakeExposed;

      perSystem = {
        system,
        self',
        ...
      }: let
        overlays = [inputs.rust-overlay.overlays.default];
        pkgs = import inputs.nixpkgs {
          inherit system overlays;
        };

        rustToolchain = pkgs.rust-bin.fromRustupToolchainFile ./rust-toolchain.toml;

        cargoToml = builtins.fromTOML (builtins.readFile ./src-tauri/Cargo.toml);
        commonTauriLibs = with pkgs; [
          at-spi2-atk
          atk
          cairo
          dbus
          gdk-pixbuf
          glib
          gtk3
          libxkbcommon
          libsoup_3
          openssl
          pango
        ];
        wryLibs = commonTauriLibs ++ [pkgs.webkitgtk_4_1];
        cefLibs = with pkgs; [
          fontconfig.lib
          alsa-lib
          at-spi2-atk
          cairo
          cups
          dbus
          expat
          gdk-pixbuf
          glib
          gtk3
          libgbm
          libglvnd
          libx11
          libxcb
          libxcomposite
          libxdamage
          libxext
          libxfixes
          libxkbcommon
          libxrandr
          nspr
          nss
          openssl
          pango
          systemdLibs
        ];

        cefBinary =
          if pkgs.stdenv.hostPlatform.system == "x86_64-linux"
          then
            pkgs.cef-binary.override {
              version = "150.0.14";
              gitRevision = "7c1aa68";
              chromiumVersion = "150.0.7871.129";
              srcHashes = {
                x86_64-linux = "sha256-QO9hPkVcrNB6p8gfQl76qLb3frg/E8wo1HDuuk5h+Y8=";
              };
            }
          else null;
        cefFlat =
          if cefBinary == null
          then null
          else let
            cefArchiveJson = pkgs.writeText "archive.json" (builtins.toJSON {
              name = cefBinary.src.name;
              sha1 = "";
              type = "minimal";
            });
          in
            pkgs.symlinkJoin {
              name = "cef-${cefBinary.version}-flat";
              paths = [
                "${cefBinary}/${cefBinary.buildType}"
                "${cefBinary}/Resources"
              ];
              postBuild = ''
                ln -s ${cefBinary}/libcef_dll "$out/"
                ln -s ${cefArchiveJson} "$out/archive.json"
              '';
            };

        rustPlatform = pkgs.makeRustPlatform {
          cargo = rustToolchain;
          rustc = rustToolchain;
        };

        frontend = pkgs.buildNpmPackage {
          pname = "querymt-desktop-frontend";
          version = cargoToml.package.version;
          src = ./.;
          npmDeps = pkgs.importNpmLock {
            npmRoot = ./.;
          };
          npmConfigHook = pkgs.importNpmLock.npmConfigHook;
          npmBuildScript = "build";
          installPhase = ''
            runHook preInstall
            mkdir -p $out
            cp -r build/. $out/
            runHook postInstall
          '';
          doCheck = false;
        };

        querymt-desktop-wry = rustPlatform.buildRustPackage {
          pname = "querymt-desktop";
          version = cargoToml.package.version;
          src = ./src-tauri;

          cargoLock = {
            lockFile = ./src-tauri/Cargo.lock;
            allowBuiltinFetchGit = true;
          };

          nativeBuildInputs = with pkgs; [
            pkg-config
            makeWrapper
            jq
          ];

          buildInputs = wryLibs;

          # Nix uses cargo directly (not `tauri build`), so enable embedded assets explicitly.
          cargoBuildFlags = ["--features" "custom-protocol"];

          preBuild = ''
            FRONTEND_DIR="$PWD/../build"
            mkdir -p "$FRONTEND_DIR"
            cp -r ${frontend}/. "$FRONTEND_DIR/"

            jq --arg dist "$FRONTEND_DIR" '.build.frontendDist = $dist | del(.build.devUrl)' tauri.conf.json > tauri.conf.json.tmp && mv tauri.conf.json.tmp tauri.conf.json
          '';

          doCheck = false;

          postFixup = ''
            wrapProgram $out/bin/querymt-desktop \
              --prefix LD_LIBRARY_PATH : "${pkgs.lib.makeLibraryPath wryLibs}"
          '';
        };

        querymt-desktop-cef =
          if cefFlat == null
          then null
          else
            rustPlatform.buildRustPackage {
              pname = "querymt-desktop-cef";
              version = cargoToml.package.version;
              src = ./src-tauri;

              cargoLock = {
                lockFile = ./src-tauri/Cargo.lock;
                allowBuiltinFetchGit = true;
              };

              nativeBuildInputs = with pkgs; [
                pkg-config
                makeWrapper
                jq
                patchelf
                cmake
                ninja
              ];
              # Published `tauri-runtime` still links WebKitGTK during compilation,
              # but the CEF executable has no WebKitGTK DT_NEEDED entry.
              buildInputs = wryLibs;
              CEF_PATH = "${cefFlat}";
              dontUseNinjaBuild = true;
              dontUseNinjaInstall = true;
              cargoBuildFlags = [
                "--no-default-features"
                "--features"
                "cef,custom-protocol"
              ];

              preBuild = ''
                FRONTEND_DIR="$PWD/../build"
                mkdir -p "$FRONTEND_DIR"
                cp -r ${frontend}/. "$FRONTEND_DIR/"
                jq --arg dist "$FRONTEND_DIR" '.build.frontendDist = $dist | del(.build.devUrl)' tauri.conf.json > tauri.conf.json.tmp && mv tauri.conf.json.tmp tauri.conf.json
              '';

              doCheck = false;

              postInstall = ''
                cp -L ${cefFlat}/*.so* $out/bin/ 2>/dev/null || true
                cp -L ${cefFlat}/*.pak ${cefFlat}/*.dat ${cefFlat}/*.bin ${cefFlat}/*.json $out/bin/ 2>/dev/null || true
                mkdir -p $out/bin/locales
                cp -L ${cefFlat}/locales/en-US.pak $out/bin/locales/
                cp ${cefBinary}/LICENSE.txt $out/bin/CEF-LICENSE.txt
                rm -f $out/bin/chrome-sandbox

                # buildRustPackage also collects copied CEF libraries as Rust outputs.
                # Keep one runtime copy beside the executable where CEF expects it.
                for library in ${cefFlat}/*.so*; do
                  rm -f "$out/lib/$(basename "$library")"
                done
              '';

              postFixup = ''
                patchelf --shrink-rpath $out/bin/querymt-desktop
                wrapProgram $out/bin/querymt-desktop \
                  --set GDK_BACKEND x11 \
                  --prefix LD_LIBRARY_PATH : "${pkgs.lib.makeLibraryPath cefLibs}:$out/bin"
              '';

              meta.mainProgram = "querymt-desktop";
            };

        querymt-desktop =
          if querymt-desktop-cef != null
          then querymt-desktop-cef
          else querymt-desktop-wry;
      in {
        packages =
          {
            default = querymt-desktop;
            querymt-desktop = querymt-desktop;
            querymt-desktop-wry = querymt-desktop-wry;
          }
          // pkgs.lib.optionalAttrs (querymt-desktop-cef != null) {
            querymt-desktop-cef = querymt-desktop-cef;
          };

        apps = {
          default = {
            type = "app";
            program = "${self'.packages.querymt-desktop}/bin/querymt-desktop";
          };
        };

        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_24
            rustToolchain
            pkg-config
            openssl
            dbus
            glib
            gtk3
            libsoup_3
            webkitgtk_4_1
          ];

          LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath (cefLibs ++ wryLibs);
          PKG_CONFIG_PATH = pkgs.lib.makeSearchPath "lib/pkgconfig" wryLibs;

          shellHook = ''
            export PS1="(dev:querymt-desktop) $PS1"
          '';
        };
      };
    };
}